import { foldSlug } from "@wowpvp/core";
import type { Queryable } from "@wowpvp/data";
import type pg from "pg";

/**
 * Alta y reconciliación de identidades de personaje.
 *
 * Vive aparte de los jobs porque la reconciliación de renombres y transferencias
 * no es un detalle de la ingesta de leaderboard: cualquier fuente que traiga un
 * personaje (leaderboard, muestreo, búsqueda de usuario) se encuentra con el
 * mismo problema, y dos implementaciones de esto divergirían hasta partir el
 * histórico de alguien por el lado que se olvidara de actualizar.
 */

/**
 * Una identidad tal como la trae la fuente. `null` es "no venía", no "no tiene".
 *
 * No lleva `nameFold`: es derivado de `nameSlug` y lo calcula el upsert. Si
 * pudiera pasarse por fuera, una fuente podría guardar un plegado incoherente
 * con su propio nombre y ese personaje dejaría de aparecer en las búsquedas sin
 * que nada fallara.
 */
export interface CharacterIdentity {
  realmSlug: string;
  nameSlug: string;
  nameDisplay: string;
  faction: string | null;
  blizzardCharacterId: number | null;
}

/** Clave con la que se devuelven los ids resueltos. */
export function identityKey(realmSlug: string, nameSlug: string): string {
  return `${realmSlug}|${nameSlug}`;
}

/**
 * Inserta o actualiza identidades y devuelve el id interno de cada una, indexado
 * por identityKey().
 *
 * Recibe un client con transacción ya abierta a propósito: quien llama suele
 * necesitar que los snapshots entren o no entren junto con la identidad.
 *
 * `verifiedAt` es cuándo habló Blizzard de estos personajes —la publicación del
 * leaderboard, la respuesta del perfil—, no cuándo se escribe: es la prueba de
 * existencia que la revalidación de 30 días cuenta (ADR 0043), y reingerir un
 * fichero viejo de la caché no puede darla por más reciente de lo que es.
 */
export async function upsertCharacters(
  client: pg.PoolClient,
  region: string,
  identities: readonly CharacterIdentity[],
  verifiedAt: Date | string,
): Promise<Map<string, string>> {
  if (identities.length === 0) return new Map();

  const realmSlugs = identities.map((i) => i.realmSlug);
  const nameSlugs = identities.map((i) => i.nameSlug);
  const nameFolds = nameSlugs.map(foldSlug);
  const displayNames = identities.map((i) => i.nameDisplay);
  const factions = identities.map((i) => i.faction);
  const blizzardIds = identities.map((i) => i.blizzardCharacterId);

  // 00) Un nombre que ya teníamos llega con otro id de Blizzard: es otro
  //     personaje. El de antes se renombró, se transfirió o se borró, y en
  //     cualquier caso el que responde ahora a ese nombre no es él. Sin este
  //     paso, el upsert de abajo le pondría el id nuevo a la fila vieja y el
  //     recién llegado heredaría el histórico de un desconocido.
  //
  //     Se borra y no se suelta el id, porque es lo que Blizzard pide cuando el
  //     id no coincide con el que se guardó (ADR 0043). Si el personaje viejo
  //     sigue existiendo con otro nombre y aparece en esta misma ingesta, entra
  //     como nuevo: dos personajes que se intercambian el nombre pierden su
  //     histórico, que es el lado seguro de un caso que no se puede resolver sin
  //     adivinar.
  const { rows: recycled } = await client.query<{ id: string }>(
    `select c.id
       from characters c
       join unnest($2::text[], $3::text[], $4::bigint[])
            as u(realm_slug, name_slug, blizzard_character_id)
         on c.realm_slug = u.realm_slug and c.name_slug = u.name_slug
      where c.region = $1
        and c.blizzard_character_id is not null
        and u.blizzard_character_id is not null
        and c.blizzard_character_id <> u.blizzard_character_id`,
    [region, realmSlugs, nameSlugs, blizzardIds],
  );
  await eraseCharacters(
    client,
    recycled.map((row) => row.id),
    "id-changed",
  );

  // 0) Reconciliar los personajes que se han renombrado o transferido desde la
  //    ingesta anterior. Sin esto, el mismo blizzard_character_id acabaría en
  //    dos filas (la vieja y la del nombre nuevo) y chocaría contra
  //    idx_characters_blizzard_id, abortando la ingesta entera — un problema
  //    que no existía cuando la ingesta era manual y única, y que aparece en
  //    cada corrida ahora que el job es periódico (11 casos en 2 días).
  //
  //    Se mueve la fila existente en vez de crear una nueva a propósito: el
  //    personaje es el mismo, y partir su histórico en dos identidades lo
  //    rompería justo donde está el valor del producto, además de contarlo dos
  //    veces en la población (y con ella, en el n que declara la confianza).
  //
  //    No se toca la fila si el nombre nuevo ya lo ocupa otra: los nombres se
  //    reciclan, y sobrescribir a un tercero sería peor que dejar el caso sin
  //    reconciliar (lo recoge el paso 0b).
  await client.query(
    `update characters c
        set realm_slug = u.realm_slug,
            name_slug = u.name_slug,
            name_fold = u.name_fold,
            name_display = u.name_display
       from unnest($2::bigint[], $3::text[], $4::text[], $5::text[], $6::text[])
            as u(blizzard_character_id, realm_slug, name_slug, name_display, name_fold)
      where c.region = $1
        and c.blizzard_character_id = u.blizzard_character_id
        and (c.realm_slug, c.name_slug) is distinct from (u.realm_slug, u.name_slug)
        and not exists (
          select 1 from characters other
           where other.region = $1
             and other.realm_slug = u.realm_slug
             and other.name_slug = u.name_slug
             and other.id <> c.id)`,
    [region, blizzardIds, realmSlugs, nameSlugs, displayNames, nameFolds],
  );

  // 0b) Lo que no se pudo reconciliar (el nombre nuevo ya está ocupado) suelta
  //     el id de Blizzard para no bloquear el índice único. Se pierde el enlace
  //     con el personaje real, no su histórico: la fila y sus snapshots siguen
  //     ahí bajo su identidad antigua, que es lo único que sabemos de ella.
  await client.query(
    `update characters c
        set blizzard_character_id = null
       from unnest($2::bigint[], $3::text[], $4::text[])
            as u(blizzard_character_id, realm_slug, name_slug)
      where c.region = $1
        and c.blizzard_character_id = u.blizzard_character_id
        and (c.realm_slug, c.name_slug) is distinct from (u.realm_slug, u.name_slug)`,
    [region, blizzardIds, realmSlugs, nameSlugs],
  );

  // 1) Upsert de identidades. La identidad es (region, realm, name): estable
  //    aunque cambie rating o spec.
  //
  //    faction y blizzard_character_id se fusionan con coalesce, no se pisan:
  //    una fuente que no traiga el dato está diciendo "no disponible", nunca
  //    "no tiene" (regla 5), y borrar un id ya conocido rompería la
  //    reconciliación del paso 0 en la siguiente corrida.
  //
  //    La prueba de existencia solo avanza, y cualquier prueba anula un 404
  //    pendiente de confirmar del barrido.
  await client.query(
    `insert into characters
       (region, realm_slug, name_slug, name_fold, name_display, faction, blizzard_character_id,
        verified_at)
     select u.*, $8::timestamptz
       from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::text[],
                   $7::bigint[]) as u
     on conflict (region, realm_slug, name_slug)
     do update set name_display = excluded.name_display,
                   name_fold = excluded.name_fold,
                   faction = coalesce(excluded.faction, characters.faction),
                   blizzard_character_id = coalesce(excluded.blizzard_character_id,
                                                    characters.blizzard_character_id),
                   verified_at = greatest(characters.verified_at, excluded.verified_at),
                   missing_since = null`,
    [
      identities.map(() => region),
      realmSlugs,
      nameSlugs,
      nameFolds,
      displayNames,
      factions,
      blizzardIds,
      verifiedAt,
    ],
  );

  // 2) Resolver los ids recién insertados/actualizados.
  const idRows = await client.query<{ id: string; realm_slug: string; name_slug: string }>(
    `select c.id, c.realm_slug, c.name_slug
     from unnest($2::text[], $3::text[]) as u(realm_slug, name_slug)
     join characters c on c.region = $1 and c.realm_slug = u.realm_slug and c.name_slug = u.name_slug`,
    [region, realmSlugs, nameSlugs],
  );

  return new Map(idRows.rows.map((r) => [identityKey(r.realm_slug, r.name_slug), r.id]));
}

/**
 * Por qué se borra a un personaje (ADR 0043). Son también los valores que admite
 * el check de `character_erasures`.
 */
export type ErasureReason = "not-found" | "invalid" | "id-changed";

export interface EraseOptions {
  /**
   * Solo borra a quien no tenga una prueba de existencia desde esta fecha.
   *
   * Lo pasa el barrido, que decide con una respuesta de Blizzard que tardó en
   * llegar: si entre medias el leaderboard lo vio —con este nombre, o con otro
   * al que la ingesta ya movió la fila—, el personaje existe y el 404 era de
   * su nombre viejo.
   */
  verifiedBefore?: Date;
}

/**
 * Borra personajes de Postgres y los deja en la cola de purga de Storage.
 *
 * El `on delete cascade` desde `characters` se lleva snapshots, gear,
 * talentos, presencia y actividad en la misma sentencia. Lo que no alcanza es
 * `character_lookups`, que suelta el id (`on delete set null`) y se queda con
 * el reino y el nombre en claro: esas filas se borran aquí, las que apuntan al
 * personaje y las que buscaron su nombre.
 *
 * Recibe un client con transacción abierta: el borrado y la anotación en
 * `character_erasures` tienen que ir juntos, o un personaje podría salir de
 * Postgres sin que nada recordara que hay que sacarlo también del archivo.
 *
 * Devuelve los ids borrados de verdad.
 */
export async function eraseCharacters(
  client: pg.PoolClient,
  ids: readonly string[],
  reason: ErasureReason,
  options: EraseOptions = {},
): Promise<string[]> {
  if (ids.length === 0) return [];

  // Se bloquean antes de tocar nada: la ingesta del leaderboard puede estar
  // escribiendo en la misma fila, y la condición de `verifiedBefore` tiene que
  // valer para lo que se borra, no para lo que se leyó un instante antes.
  const { rows: doomed } = await client.query<{ id: string; verified_at: Date }>(
    `select id, verified_at
       from characters
      where id = any($1::uuid[])
        and ($2::timestamptz is null or verified_at < $2)
      order by id
      for update`,
    [ids, options.verifiedBefore ?? null],
  );
  if (doomed.length === 0) return [];
  const doomedIds = doomed.map((row) => row.id);

  await client.query(
    `delete from character_lookups l
      using characters c
      where c.id = any($1::uuid[])
        and (l.character_id = c.id
             or (l.region = c.region and l.realm_slug = c.realm_slug
                 and l.name_slug = c.name_slug))`,
    [doomedIds],
  );
  await client.query(
    `insert into character_erasures (character_id, last_verified_at, reason)
     select * from unnest($1::uuid[], $2::timestamptz[], $3::text[])
     on conflict (character_id) do nothing`,
    [doomedIds, doomed.map((row) => row.verified_at), doomedIds.map(() => reason)],
  );
  await client.query(`delete from characters where id = any($1::uuid[])`, [doomedIds]);

  return doomedIds;
}

/**
 * Anota una prueba de existencia para personajes que ya están en la base.
 *
 * Es el camino de quien no pasa por `upsertCharacters`: la ingesta de perfiles
 * ya conoce el id y solo necesita decir que Blizzard acaba de devolverlo.
 */
export async function markCharactersVerified(
  db: Queryable,
  ids: readonly string[],
  verifiedAt: Date | string,
): Promise<void> {
  if (ids.length === 0) return;
  await db.query(
    `update characters
        set verified_at = greatest(verified_at, $2::timestamptz),
            missing_since = null
      where id = any($1::uuid[])`,
    [ids, verifiedAt],
  );
}
