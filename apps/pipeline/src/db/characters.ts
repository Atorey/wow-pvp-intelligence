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

/** Una identidad tal como la trae la fuente. `null` es "no venía", no "no tiene". */
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
 */
export async function upsertCharacters(
  client: pg.PoolClient,
  region: string,
  identities: readonly CharacterIdentity[],
): Promise<Map<string, string>> {
  if (identities.length === 0) return new Map();

  const realmSlugs = identities.map((i) => i.realmSlug);
  const nameSlugs = identities.map((i) => i.nameSlug);
  const displayNames = identities.map((i) => i.nameDisplay);
  const factions = identities.map((i) => i.faction);
  const blizzardIds = identities.map((i) => i.blizzardCharacterId);

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
            name_display = u.name_display
       from unnest($2::bigint[], $3::text[], $4::text[], $5::text[])
            as u(blizzard_character_id, realm_slug, name_slug, name_display)
      where c.region = $1
        and c.blizzard_character_id = u.blizzard_character_id
        and (c.realm_slug, c.name_slug) is distinct from (u.realm_slug, u.name_slug)
        and not exists (
          select 1 from characters other
           where other.region = $1
             and other.realm_slug = u.realm_slug
             and other.name_slug = u.name_slug
             and other.id <> c.id)`,
    [region, blizzardIds, realmSlugs, nameSlugs, displayNames],
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
  await client.query(
    `insert into characters (region, realm_slug, name_slug, name_display, faction, blizzard_character_id)
     select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[])
     on conflict (region, realm_slug, name_slug)
     do update set name_display = excluded.name_display,
                   faction = coalesce(excluded.faction, characters.faction),
                   blizzard_character_id = coalesce(excluded.blizzard_character_id,
                                                    characters.blizzard_character_id)`,
    [identities.map(() => region), realmSlugs, nameSlugs, displayNames, factions, blizzardIds],
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
