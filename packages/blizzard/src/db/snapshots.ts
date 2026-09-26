import type pg from "pg";
import type { SpecEntry } from "@wowpvp/core";
import type { GearRow, HeroTreeRef, TalentRow } from "../profile-mapping";

/**
 * Inserción de snapshots de perfil (los que traen gear/talentos, a diferencia de
 * los de leaderboard, que se insertan en bloque durante la ingesta).
 *
 * Compartido por el muestreo por segmento y por la búsqueda bajo demanda: la
 * única diferencia entre ambos es el `source`, y tener dos copias de este INSERT
 * significaría que un cambio en el modelo (una columna nueva de gear, otra regla
 * de idempotencia) se aplicaría a una fuente de población y no a la otra.
 */

export interface ProfileSnapshotInput {
  characterId: string;
  /** Marca temporal de la captura. Nunca now(): ver comentario de idempotencia. */
  capturedAt: string;
  /** 'profile' = muestreo nuestro; 'search' = lo trajo una búsqueda de usuario (§12). */
  source: "profile" | "search";
  seasonId: number;
  bracket: string;
  spec: SpecEntry;
  rating: number;
  matchesPlayed: number | null;
  matchesWon: number | null;
  matchesLost: number | null;
  pvpTierId: number | null;
  averageItemLevel: number | null;
  equippedItemLevel: number | null;
  talentCode: string | null;
  /**
   * Nodos del mismo loadout que `talentCode`, más los talentos PvP de la spec.
   * Vacío significa "no pudimos leerlos", igual que un `gear` vacío: los nodos
   * salen de la misma respuesta que el código, así que un personaje con código y
   * sin nodos es un fallo de lectura, no alguien sin talentos.
   */
  talents: readonly TalentRow[];
  /** null = la API no trajo el árbol de héroe, nunca "no eligió" (regla 5). */
  heroTree: HeroTreeRef | null;
  gear: readonly GearRow[];
}

export interface ProfileSnapshotResult {
  /** null solo si el snapshot no existía y tampoco se pudo insertar. */
  snapshotId: string | null;
  /** false si ya existía: reanudación de un run o búsqueda repetida. */
  isNew: boolean;
}

/**
 * Inserta el snapshot con su gear y sus talentos. Siempre INSERT, nunca UPDATE
 * (append-only, ADR 0002): un update sobre rating/gear/talentos destruiría el
 * histórico, que es el moat del producto.
 *
 * Recibe un client con transacción abierta: el snapshot y lo que cuelga de él
 * entran juntos o no entran, y quien llama suele meter también la identidad en
 * la misma.
 */
export async function insertProfileSnapshot(
  client: pg.PoolClient,
  input: ProfileSnapshotInput,
): Promise<ProfileSnapshotResult> {
  const inserted = await client.query<{ id: string }>(
    `insert into character_snapshots
       (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
        rating, matches_played, matches_won, matches_lost, pvp_tier_id,
        average_item_level, equipped_item_level, talent_loadout_code,
        hero_talent_tree_id, hero_talent_tree_name)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
     on conflict (character_id, bracket, captured_at) do nothing
     returning id`,
    [
      input.characterId,
      input.capturedAt,
      input.source,
      input.seasonId,
      input.bracket,
      input.spec.classSlug,
      input.spec.specSlug,
      input.rating,
      // ladder_rank se queda a null: el perfil no da posición de ladder, y
      // copiarla del snapshot de leaderboard mezclaría fuentes.
      input.matchesPlayed,
      input.matchesWon,
      input.matchesLost,
      input.pvpTierId,
      input.averageItemLevel,
      input.equippedItemLevel,
      input.talentCode,
      input.heroTree?.id ?? null,
      input.heroTree?.name ?? null,
    ],
  );

  const isNew = (inserted.rowCount ?? 0) > 0;

  // Si el snapshot ya existía, puede ser de un intento anterior que murió entre
  // el snapshot y su gear. Se recupera el id para completarlo en vez de dejarlo
  // a medias.
  let snapshotId = inserted.rows[0]?.id ?? null;
  if (!snapshotId) {
    const existing = await client.query<{ id: string }>(
      `select id from character_snapshots
        where character_id = $1 and bracket = $2 and captured_at = $3`,
      [input.characterId, input.bracket, input.capturedAt],
    );
    snapshotId = existing.rows[0]?.id ?? null;
  }

  if (snapshotId && input.gear.length > 0) {
    await writeGear(client, snapshotId, input.gear);
  }

  if (snapshotId && input.talents.length > 0) {
    await writeTalents(client, snapshotId, input.talents);
  }

  return { snapshotId, isNew };
}

/**
 * Las selecciones de talento de un snapshot: las etiquetas por referencia a
 * `talent_labels` (ADR 0035) y cada árbol por referencia a `talent_sets` (ADR
 * 0040), porque el mismo árbol elegido se repite entre personajes y perfiles.
 *
 * Son dos viajes y no uno porque el alta del catálogo no devuelve el id de lo
 * que ya estaba: un `do update` sin condición sí lo devolvería, pero escribiría
 * una versión nueva de las ~85 etiquetas de cada perfil para no cambiar nada, y
 * eso hincha una tabla de 3.500 filas a base de tuplas muertas. Se da de alta lo
 * que falte y después se resuelve el conjunto entero.
 */
async function writeTalents(
  client: pg.PoolClient,
  snapshotId: string,
  talents: readonly TalentRow[],
): Promise<void> {
  const trees = talents.map((t) => t.tree);
  const nodeIds = talents.map((t) => t.talentId);
  const names = talents.map((t) => t.talentName);

  // El `do update` está acotado a las etiquetas que todavía no tienen talent_id:
  // las 3.515 que vienen de 0012 nunca lo guardaron, y sin esto se quedarían a
  // null para siempre —justo las más comunes, que son las que importan—. En
  // cuanto una se rellena deja de reescribirse, así que la reescritura ocurre
  // una vez por etiqueta y no una por perfil.
  await client.query(
    `insert into talent_labels (tree, node_id, name, talent_id)
     select tree, node_id, name, talent_id
       from unnest($1::text[], $2::int[], $3::text[], $4::int[])
            as t(tree, node_id, name, talent_id)
     on conflict (tree, node_id, name) do update
        set talent_id = excluded.talent_id
      where talent_labels.talent_id is null
        and excluded.talent_id is not null`,
    [trees, nodeIds, names, talents.map((t) => t.selectedTalentId)],
  );

  // chr(1) como centinela para que el join sea hashable: comparar el nombre con
  // `is not distinct from` fuerza un nested loop contra el catálogo entero.
  const { rows: labels } = await client.query<{ id: number; tree: string; node_id: number }>(
    `select l.id, l.tree, l.node_id
       from talent_labels l
       join unnest($1::text[], $2::int[], $3::text[]) as t(tree, node_id, name)
         on l.tree = t.tree
        and l.node_id = t.node_id
        and coalesce(l.name, chr(1)) = coalesce(t.name, chr(1))`,
    [trees, nodeIds, names],
  );

  const labelByKey = new Map(labels.map((row) => [`${row.tree}:${row.node_id}`, row.id]));

  // El orden de label_ids y ranks tiene que ser el mismo, porque ranks es
  // paralelo posición a posición y no lleva su propia clave.
  const byTree = new Map<string, { labelIds: number[]; ranks: (number | null)[] }>();
  for (const talent of talents) {
    const labelId = labelByKey.get(`${talent.tree}:${talent.talentId}`);
    // Sin etiqueta no hay nada que guardar: la selección se perdería igual, y
    // meterla con un id inventado la haría irresoluble al leerla.
    if (labelId === undefined) continue;

    let bucket = byTree.get(talent.tree);
    if (!bucket) {
      bucket = { labelIds: [], ranks: [] };
      byTree.set(talent.tree, bucket);
    }
    bucket.labelIds.push(labelId);
    bucket.ranks.push(talent.rank);
  }

  if (byTree.size === 0) return;

  await writeByReference(
    client,
    snapshotId,
    TALENT_SETS,
    // null entero en 'pvp', que no tiene rangos (ADR 0026).
    [...byTree.entries()].map(([tree, { labelIds, ranks }]) => [
      tree,
      labelIds,
      tree === "pvp" ? null : ranks,
    ]),
  );
}

/**
 * El equipo de un snapshot: una fila con referencias a `gear_pieces` (ADR 0040).
 * La pieza se da de alta si no existía; casi siempre existe, porque solo una de
 * cada diez filas de slot observadas era distinta de todas las demás.
 */
async function writeGear(
  client: pg.PoolClient,
  snapshotId: string,
  gear: readonly GearRow[],
): Promise<void> {
  await writeByReference(
    client,
    snapshotId,
    GEAR_PIECES,
    gear.map((item) => [
      item.slot,
      item.itemId,
      item.itemName,
      item.itemLevel,
      item.quality,
      item.enchantmentIds,
      item.enchantmentNames,
      item.gemItemIds,
      item.gemItemNames,
      item.bonusList,
    ]),
  );
}

/**
 * Un catálogo de contenido y la tabla de observación que lo apunta (ADR 0040).
 * Las columnas van en el orden de los argumentos de la función de huella.
 */
export interface ContentCatalog {
  table: string;
  columns: readonly string[];
  /** El tipo de cada columna: las tuplas del `values` que se cruzan no tienen un insert que se lo dé. */
  types: readonly string[];
  fingerprint: string;
  observation: string;
  refs: string;
}

export const GEAR_PIECES: ContentCatalog = {
  table: "gear_pieces",
  columns: [
    "slot",
    "item_id",
    "item_name",
    "item_level",
    "quality",
    "enchantment_ids",
    "enchantment_names",
    "gem_item_ids",
    "gem_item_names",
    "bonus_list",
  ],
  types: ["text", "bigint", "text", "int", "text", "int[]", "text[]", "int[]", "text[]", "int[]"],
  fingerprint: "gear_piece_fingerprint",
  observation: "character_snapshot_gear",
  refs: "piece_ids",
};

export const TALENT_SETS: ContentCatalog = {
  table: "talent_sets",
  columns: ["tree", "label_ids", "ranks"],
  types: ["text", "int[]", "smallint[]"],
  fingerprint: "talent_set_fingerprint",
  observation: "character_snapshot_talents",
  refs: "set_ids",
};

/**
 * Escribe un contenido por referencia: alta de lo que falte en el catálogo y una
 * fila de observación con los ids de todo.
 *
 * Son dos viajes por lo mismo que las etiquetas de talento: el `on conflict do
 * nothing` no devuelve el id de lo que ya estaba, y un `do update` para
 * conseguirlo reescribiría una fila del catálogo en cada perfil. La resolución
 * cruza por la huella, que calcula Postgres con la misma función que la columna
 * generada: si la calculara este código, una diferencia de un carácter al
 * escribir el JSON dejaría piezas sin resolver.
 *
 * Un INSERT multi-fila y no un unnest en bloque: las columnas son arrays de
 * largo variable, y unnest sobre un array de arrays los aplanaría.
 */
async function writeByReference(
  client: pg.PoolClient,
  snapshotId: string,
  catalog: ContentCatalog,
  rows: readonly (readonly unknown[])[],
): Promise<void> {
  const values = (offset: number): { sql: string; params: unknown[] } => {
    const params: unknown[] = [];
    const tuples = rows.map((row) => {
      const cells = row.map((value, i) => {
        params.push(value);
        return `$${offset + params.length}::${catalog.types[i]}`;
      });
      return `(${cells.join(", ")})`;
    });
    return { sql: tuples.join(", "), params };
  };

  const columns = catalog.columns.join(", ");
  const insert = values(0);
  await client.query(
    `insert into ${catalog.table} (${columns})
     values ${insert.sql}
     on conflict (fingerprint) do nothing`,
    insert.params,
  );

  // $1 es el snapshot_id; las tuplas empiezan en $2.
  const resolve = values(1);
  const { rows: written } = await client.query<{ refs: number }>(
    `insert into ${catalog.observation} (snapshot_id, ${catalog.refs})
     select $1, array_agg(c.id order by c.id)
       from (values ${resolve.sql}) as v(${columns})
       join ${catalog.table} c
         on c.fingerprint = ${catalog.fingerprint}(${catalog.columns.map((col) => `v.${col}`).join(", ")})
     on conflict (snapshot_id) do nothing
     returning cardinality(${catalog.refs}) as refs`,
    [snapshotId, ...resolve.params],
  );

  // Sin fila devuelta es que el snapshot ya tenía su contenido: la reanudación
  // de una corrida. Con fila y menos referencias que entradas, algo no se
  // resolvió, y guardarlo así sería afirmar un equipo al que le falta una pieza.
  const refs = written[0]?.refs;
  if (refs !== undefined && refs !== rows.length) {
    throw new Error(
      `${catalog.observation}: ${rows.length} entradas y ${refs} resueltas contra ` +
        `${catalog.table} para el snapshot ${snapshotId}.`,
    );
  }
}
