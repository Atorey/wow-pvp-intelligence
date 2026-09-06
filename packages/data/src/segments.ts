import type { ActivityWindowDays, AggregatedVariable, RatingSegment, Region } from "@wowpvp/core";
import { toNumber, toNumberOrNull } from "./columns";
import { provenanceFor, type Provenance } from "./provenance";
import type { Queryable } from "./queryable";

/** Qué escalón se está pidiendo. `segmentId` es la clave estable de BD y de URL. */
export interface SegmentKey {
  region: Region;
  seasonId: number;
  bracket: string;
  segmentId: string;
}

/**
 * Un escalón tal y como lo enseña la web: el `population_segments` más reciente
 * del par, con **una procedencia por cada base de cálculo distinta**.
 *
 * Seis y no una porque son seis denominadores que difieren en órdenes de
 * magnitud: en agosto de 2026, 31.488 personajes de población frente a 0
 * perfiles con gear. Una sola `Provenance` obligaría a elegir uno, y el que
 * suena a respuesta —la población— es justo el que no lo es (ADR 0010, punto 3).
 */
export interface SegmentRead {
  /**
   * Clave de la fila, para encadenar la lectura de sus agregados. No sale a la
   * URL: la clave pública del escalón es `SegmentKey`, que sí es estable entre
   * recálculos.
   */
  rowId: string;
  region: string;
  seasonId: number;
  bracket: string;
  classSlug: string;
  specSlug: string;
  segment: RatingSegment;
  /** Con qué ventana se recortó la población de **este** escalón (§13.4, ADR 0007). */
  activityWindowDays: ActivityWindowDays;
  /**
   * Población observada del escalón. Sostiene el percentil y el ranking, que no
   * necesitan gear (ADR 0011, punto 2b). Nunca la comparación.
   */
  population: Provenance;
  /**
   * Base de comparación del gear: `gear_sample`. La que decide el Player Gap, y
   * la de las **tres** variables de gear —item, gema y encantamiento—, que salen
   * de la misma fila observada y por eso no necesitan una suya (ADR 0027).
   */
  gear: Provenance;
  /**
   * Base de comparación por código de loadout. Separada de la de gear porque no
   * coinciden, y separada de `talentNodes` porque miden cosas distintas: esta
   * cuenta quién tiene código, que es un dato más viejo y más disponible.
   *
   * Lo que sostiene una comparación de talentos es `talentNodes`, no esta
   * (ADR 0026).
   */
  talents: Provenance;
  /** Base de comparación por nodo: la que decide si se puede comparar la build. */
  talentNodes: Provenance;
  /** Base de los talentos PvP. Propia: faltan por razones que no son las del loadout. */
  pvpTalents: Provenance;
  /** Base de la mediana de item level. */
  itemLevel: Provenance;
  rating: {
    median: number | null;
    p25: number | null;
    p75: number | null;
    min: number | null;
    max: number | null;
  };
  equippedItemLevelMedian: number | null;
  /**
   * Entre qué fechas se bajaron los perfiles que aportan el gear. El rating es
   * de hoy y el gear puede ser de hace días: vienen de fuentes distintas del
   * mismo personaje, y el desfase se declara en vez de dejarlo suponer.
   */
  profileData: { from: Date | null; to: Date | null };
  /** Cuántos quedaron fuera por venir solo de búsqueda (ADR 0007, punto 8). */
  excludedSearch: number;
  /**
   * De la población activa, cuántos entraron por subida vista del contador de
   * partidas y cuántos por primera observación. Mientras el histórico sea corto
   * domina la segunda, y eso cambia lo que se puede afirmar del escalón (§27).
   */
  activity: { byDelta: number; byFirstSeen: number };
}

export interface SegmentRow {
  id: string;
  computed_at: Date;
  region: string;
  season_id: number;
  bracket: string;
  class_slug: string;
  spec_slug: string;
  segment_id: string;
  segment_min: number;
  segment_max: number | null;
  activity_window_days: number;
  sample_size: number;
  gear_sample: number;
  talent_sample: number;
  talent_node_sample: number;
  pvp_talent_sample: number;
  item_level_sample: number;
  rating_median: string | null;
  rating_p25: string | null;
  rating_p75: string | null;
  rating_min: number | null;
  rating_max: number | null;
  equipped_item_level_median: string | null;
  profile_data_from: Date | null;
  profile_data_to: Date | null;
  excluded_search: number;
  active_by_delta: number;
  active_by_first_seen: number;
}

/**
 * La lista de columnas es explícita y **no incluye `confidence`**.
 *
 * No es cuestión de estilo: esa columna mide población, no base de comparación,
 * y con un `select *` acabaría en la fila cruda esperando a que alguien la
 * mapease "para no perder nada". Nombrarlas una a una convierte añadirla en un
 * acto deliberado y visible en el diff.
 */
const SEGMENT_COLUMNS = `id, computed_at, region, season_id, bracket, class_slug, spec_slug,
       segment_id, segment_min, segment_max, activity_window_days,
       sample_size, gear_sample, talent_sample, talent_node_sample, pvp_talent_sample,
       item_level_sample,
       rating_median, rating_p25, rating_p75, rating_min, rating_max,
       equipped_item_level_median, profile_data_from, profile_data_to,
       excluded_search, active_by_delta, active_by_first_seen`;

/**
 * `segment_max` es null en el tramo abierto de arriba. `Infinity` es lo que usa
 * `packages/core` para lo mismo, y traducirlo aquí evita que cada consumidor
 * reinvente qué significaba ese null.
 */
export function toSegmentRead(row: SegmentRow): SegmentRead {
  const base = { computedAt: row.computed_at, sampleSize: row.sample_size };

  return {
    rowId: row.id,
    region: row.region,
    seasonId: row.season_id,
    bracket: row.bracket,
    classSlug: row.class_slug,
    specSlug: row.spec_slug,
    segment: {
      id: row.segment_id,
      min: row.segment_min,
      max: row.segment_max ?? Infinity,
    },
    activityWindowDays: row.activity_window_days as ActivityWindowDays,
    population: provenanceFor({ ...base, denominator: row.sample_size }),
    gear: provenanceFor({ ...base, denominator: row.gear_sample }),
    talents: provenanceFor({ ...base, denominator: row.talent_sample }),
    talentNodes: provenanceFor({ ...base, denominator: row.talent_node_sample }),
    pvpTalents: provenanceFor({ ...base, denominator: row.pvp_talent_sample }),
    itemLevel: provenanceFor({ ...base, denominator: row.item_level_sample }),
    rating: {
      median: toNumberOrNull(row.rating_median),
      p25: toNumberOrNull(row.rating_p25),
      p75: toNumberOrNull(row.rating_p75),
      min: row.rating_min,
      max: row.rating_max,
    },
    equippedItemLevelMedian: toNumberOrNull(row.equipped_item_level_median),
    profileData: { from: row.profile_data_from, to: row.profile_data_to },
    excludedSearch: row.excluded_search,
    activity: { byDelta: row.active_by_delta, byFirstSeen: row.active_by_first_seen },
  };
}

/**
 * El escalón calculado más recientemente.
 *
 * "El `computed_at` más alto" y no "el de hoy": una corrida puede fallar, y en
 * ese caso la web enseña el agregado de ayer **con su fecha**, que es lo que
 * dirá `computedAt`. Esconder que el dato es de ayer sería peor que el dato de
 * ayer.
 *
 * null significa que ese par no se ha calculado nunca, que no es lo mismo que
 * calcularse con muestra insuficiente: el segundo caso sí devuelve fila, con su
 * confianza en `insufficient`, y es el que permite explicar por qué no hay
 * comparación (ADR 0011) en vez de servir una página en blanco.
 */
export async function readSegment(db: Queryable, key: SegmentKey): Promise<SegmentRead | null> {
  const { rows } = await db.query<SegmentRow>(
    `select ${SEGMENT_COLUMNS}
       from population_segments
      where region = $1 and season_id = $2 and bracket = $3 and segment_id = $4
      order by computed_at desc
      limit 1`,
    [key.region, key.seasonId, key.bracket, key.segmentId],
  );

  const row = rows[0];
  return row ? toSegmentRead(row) : null;
}

/**
 * Todos los escalones calculados de un bracket, de una sola corrida.
 *
 * De una sola porque mezclar corridas sería pintar juntos escalones calculados
 * sobre poblaciones distintas: la página diría que un tramo creció cuando lo
 * que cambió fue la fecha de la que viene cada fila.
 */
export async function readBracketSegments(
  db: Queryable,
  key: Omit<SegmentKey, "segmentId">,
): Promise<SegmentRead[]> {
  const { rows } = await db.query<SegmentRow>(
    `select ${SEGMENT_COLUMNS}
       from population_segments
      where region = $1 and season_id = $2 and bracket = $3
        and computed_at = (
          select max(computed_at) from population_segments
           where region = $1 and season_id = $2 and bracket = $3
        )
      order by segment_min`,
    [key.region, key.seasonId, key.bracket],
  );

  return rows.map(toSegmentRead);
}

/**
 * Lo justo para decidir si una URL de segmento es indexable (ADR 0029): las
 * tres bases de comparación que puede tener un escalón, y de cuándo son.
 *
 * No lleva rating, ni medianas, ni población: nada de eso decide la
 * indexabilidad, y traerlo invitaría a pintar una página con esta lectura.
 */
export interface SegmentSampleRead {
  bracket: string;
  segmentId: string;
  gear: Provenance;
  talentNodes: Provenance;
  pvpTalents: Provenance;
}

interface SegmentSampleRow {
  bracket: string;
  segment_id: string;
  computed_at: Date;
  sample_size: number;
  gear_sample: number;
  talent_node_sample: number;
  pvp_talent_sample: number;
}

/**
 * Las bases de comparación de **todos** los escalones de la temporada vigente,
 * en una sola consulta.
 *
 * Existe para el sitemap (#26): decidir qué URL se publican recorriendo
 * `readBracketSegments` spec a spec serían cuarenta consultas por regeneración,
 * y el presupuesto de Netlify no da para eso (ADR 0013).
 *
 * A diferencia de `readBracketSegments`, aquí **sí** se mezclan corridas de
 * brackets distintos: cada par se resuelve con su propio `computed_at` más
 * alto. Es admisible porque lo que sale de aquí no se pinta junto en ninguna
 * página —no hay dos poblaciones comparándose— sino que decide, una URL cada
 * vez, si esa dirección tiene algo que enseñar. Para pintar un escalón sigue
 * sirviendo `readBracketSegments` y solo ese.
 *
 * También se mezclan regiones, y por la misma razón: la ruta de spec no lleva
 * región (ADR 0020), así que la URL existe si algún sitio tiene muestra.
 */
export async function readSegmentSamples(db: Queryable): Promise<SegmentSampleRead[]> {
  const { rows } = await db.query<SegmentSampleRow>(
    `select distinct on (region, bracket, segment_id)
            bracket, segment_id, computed_at, sample_size,
            gear_sample, talent_node_sample, pvp_talent_sample
       from population_segments
      where season_id = (select max(season_id) from population_segments)
      order by region, bracket, segment_id, computed_at desc`,
  );

  return rows.map((row) => {
    const base = { computedAt: row.computed_at, sampleSize: row.sample_size };
    return {
      bracket: row.bracket,
      segmentId: row.segment_id,
      gear: provenanceFor({ ...base, denominator: row.gear_sample }),
      talentNodes: provenanceFor({ ...base, denominator: row.talent_node_sample }),
      pvpTalents: provenanceFor({ ...base, denominator: row.pvp_talent_sample }),
    };
  });
}

/**
 * Qué variable se agregó. Las que escribe `refresh-aggregates` (ADR 0026, 0027).
 *
 * `talent-code` sigue existiendo y casi nunca agrupa: entre 75 y 97 códigos
 * distintos por cada 100 perfiles de un segmento. Lo que describe un escalón es
 * `talent-node`.
 *
 * Las tres de gear comparten el `gear_sample` del escalón; las de talentos, no.
 */
export type VariableKind =
  | "gear-item"
  | "gear-gem"
  | "gear-enchant"
  | "talent-code"
  | "talent-node"
  | "pvp-talent"
  | "hero-tree";

/**
 * Las columnas de una adopción, compartidas por las dos lecturas. `icon_url` da
 * por hecho el `left join` con `item_media` que las dos hacen.
 */
const ADOPTION_COLUMNS = `a.variable_kind, a.variable_key, a.slot_group, a.item_id, a.item_name,
            a.talent_tree, a.talent_id, a.talent_name,
            a.enchantment_id, a.enchantment_name,
            m.icon_url, a.users, a.denominator, a.unavailable, a.adoption_rate`;

/**
 * Un `adoption_rate` con todo lo que hace falta para poder enseñarlo.
 *
 * `users`, `denominator` y `unavailable` viajan crudos además del porcentaje
 * porque §13.5 exige que el tamaño de muestra vaya pegado a cada cifra, no en
 * una nota al pie.
 */
export interface AdoptionRead {
  kind: VariableKind;
  /**
   * Clave de la variable dentro del escalón: `'TRINKET:207581'`, `'class:99846'`,
   * `'pvp:3755'`, el id del árbol de héroe o el código de talentos completo.
   */
  variableKey: string;
  /** 'TRINKET', 'HEAD'… null en las variables que no son de gear. */
  slotGroup: string | null;
  itemId: number | null;
  itemName: string | null;
  /** 'class' | 'spec' | 'hero' | 'pvp'. null fuera de las variables de talento. */
  talentTree: string | null;
  /** Id del nodo o del talento PvP; en 'hero-tree', el id del árbol. */
  talentId: number | null;
  /**
   * Nombre del talento tal como estaba al calcular. `null` es "no disponible"
   * (regla 5): la API deja algún nodo sin tooltip, y ese nodo sí está observado.
   */
  talentName: string | null;
  /**
   * Id del encantamiento, aparte de `itemId` porque no es un item: guardarlo
   * ahí lo cruzaría con `item_media` por un número que coincide sin querer y la
   * fila saldría con el icono de otra cosa (ADR 0027).
   */
  enchantmentId: number | null;
  /**
   * Nombre del encantamiento, sacado del `display_string` de la API. `null` es
   * "no disponible" en los snapshots anteriores a la migración 0013, que traen
   * el id sin él: la adopción es correcta igual, la etiqueta llega después.
   */
  enchantmentName: string | null;
  /**
   * URL del icono en el CDN de Blizzard, del catálogo `item_media` (#67).
   *
   * `null` es "no disponible" como manda la regla 5 —el item aún no se ha
   * resuelto, o la API no publica icono para él— y nunca "este item no tiene
   * icono que enseñar". Lo que se dibuja con un null es el hueco reservado del
   * brief §4.5: la fila no se recoloca, porque el nombre y el item level son la
   * información y el icono solo acompaña.
   *
   * Que llegue una URL tampoco garantiza que la imagen cargue: el archivo es de
   * Blizzard y no se re-aloja (ADR 0015, decisión 7), así que un 403 o una URL
   * retirada terminan en el mismo hueco.
   */
  iconUrl: string | null;
  users: number;
  /**
   * Cuántos no tenían el dato. Están **fuera** del denominador, nunca contados
   * como no-adopción: `null` es "no disponible", no "no lo usa" (regla 5).
   */
  unavailable: number;
  /** El `adoption_rate` en tanto por uno, tal cual se calculó y se guardó. */
  rate: number;
  provenance: Provenance;
}

interface AdoptionRow {
  variable_kind: VariableKind;
  variable_key: string;
  slot_group: string | null;
  item_id: string | null;
  item_name: string | null;
  talent_tree: string | null;
  talent_id: string | null;
  talent_name: string | null;
  enchantment_id: string | null;
  enchantment_name: string | null;
  icon_url: string | null;
  users: number;
  denominator: number;
  unavailable: number;
  adoption_rate: string;
}

/**
 * Las adopciones de un escalón, para una variable.
 *
 * Recibe el `SegmentRead` y no un identificador de fila **a propósito**: así no
 * se puede leer un `adoption_rate` sin haber leído antes el escalón del que
 * cuelga, y por tanto no se puede pintar un porcentaje sin su `computedAt` ni
 * su denominador. El requisito de trazabilidad deja de ser algo que recordar y
 * pasa a ser algo que el tipo no deja saltarse.
 *
 * El denominador de la procedencia sale de la **fila de la variable**, no del
 * `gear_sample` del escalón: casi siempre coinciden, pero cuando difieren el
 * bueno es el de la fila, que es sobre quien de verdad se calculó ese
 * porcentaje.
 */
export async function readAdoption(
  db: Queryable,
  segment: SegmentRead,
  kind: VariableKind,
  options: { limit?: number } = {},
): Promise<AdoptionRead[]> {
  const { rows } = await db.query<AdoptionRow>(
    `select ${ADOPTION_COLUMNS}
       from aggregate_snapshots a
       -- left join, nunca inner: un item sin icono resuelto sigue siendo una
       -- adopción que hay que enseñar. Filtrar por el catálogo escondería
       -- cifras reales por un fallo de ilustración.
       left join item_media m on m.item_id = a.item_id
      where a.population_segment_id = $1 and a.variable_kind = $2
      order by a.adoption_rate desc, a.variable_key
      ${options.limit === undefined ? "" : "limit $3"}`,
    options.limit === undefined ? [segment.rowId, kind] : [segment.rowId, kind, options.limit],
  );

  return rows.map((row) => toAdoptionRead(row, segment));
}

/**
 * Las adopciones de **varios** escalones a la vez, agrupadas por `rowId`.
 *
 * Existe para poder comparar un escalón con el de arriba sin ir dos veces a la
 * base, que es lo que hace `biggestDifferences()` de core: la alternativa era
 * que la web recargase las dos poblaciones enteras desde `character_snapshots`,
 * y esa consulta no cabe en una petición de página.
 *
 * Sigue recibiendo los `SegmentRead` y no sus ids, por la razón del punto 8 del
 * ADR 0014: cada adopción sale con la procedencia de su propio escalón, así que
 * no se puede pintar un porcentaje sin su fecha ni su denominador. Un escalón
 * sin filas de esa variable **aparece igual, con la lista vacía**: eso es
 * "todavía no se ha calculado ahí", que es distinto de un `undefined` que el
 * llamante interpretaría como quiera.
 *
 * Admite varias variables de una vez, y eso solo vale para las que comparten
 * denominador: las tres de gear salen de la misma fila observada y por eso se
 * ordenan juntas en un mismo ranking (ADR 0027). Pedir en la misma llamada gear
 * y talentos mezclaría en una lista dos porcentajes calculados sobre gente
 * distinta.
 */
export async function readAdoptionFor(
  db: Queryable,
  segments: readonly SegmentRead[],
  kind: VariableKind | readonly VariableKind[],
): Promise<Map<string, AdoptionRead[]>> {
  const byRowId = new Map(segments.map((segment) => [segment.rowId, segment]));
  const grouped = new Map<string, AdoptionRead[]>(segments.map((segment) => [segment.rowId, []]));
  if (segments.length === 0) return grouped;

  const { rows } = await db.query<AdoptionRow & { population_segment_id: string }>(
    `select a.population_segment_id, ${ADOPTION_COLUMNS}
       from aggregate_snapshots a
       left join item_media m on m.item_id = a.item_id
      where a.population_segment_id = any($1::bigint[])
        and a.variable_kind = any($2::text[])
      order by a.population_segment_id, a.adoption_rate desc, a.variable_key`,
    [[...byRowId.keys()], typeof kind === "string" ? [kind] : [...kind]],
  );

  for (const row of rows) {
    const segment = byRowId.get(row.population_segment_id);
    // Imposible salvo que la base devuelva una fila que no se pidió, y en ese
    // caso se descarta: sin su escalón no hay procedencia con la que enseñarla.
    if (!segment) continue;
    grouped.get(row.population_segment_id)?.push(toAdoptionRead(row, segment));
  }

  return grouped;
}

function toAdoptionRead(row: AdoptionRow, segment: SegmentRead): AdoptionRead {
  return {
    kind: row.variable_kind,
    variableKey: row.variable_key,
    slotGroup: row.slot_group,
    itemId: row.item_id === null ? null : toNumber(row.item_id),
    itemName: row.item_name,
    talentTree: row.talent_tree,
    talentId: row.talent_id === null ? null : toNumber(row.talent_id),
    talentName: row.talent_name,
    enchantmentId: row.enchantment_id === null ? null : toNumber(row.enchantment_id),
    enchantmentName: row.enchantment_name,
    iconUrl: row.icon_url,
    users: row.users,
    unavailable: row.unavailable,
    rate: toNumber(row.adoption_rate),
    provenance: provenanceFor({
      computedAt: segment.population.computedAt,
      sampleSize: segment.population.sampleSize,
      denominator: row.denominator,
    }),
  };
}

/**
 * Una adopción leída, en la forma que compara `packages/core`.
 *
 * El puente vive aquí y no en quien pinta porque es el mismo en todas las
 * páginas que comparen dos escalones, y porque lo que traduce es delicado: el
 * denominador del porcentaje sale de **la fila de la variable**, que es sobre
 * quien de verdad se calculó, y no del `gear_sample` del escalón. Recomponerlo
 * en cada consumidor es como se acaba comparando un porcentaje contra una base
 * que no es la suya.
 *
 * Lo que se pierde en el viaje —el icono, la procedencia— no se pierde: sigue en
 * el `AdoptionRead` de origen, que el consumidor conserva para pintar la fila.
 * `core` no sabe de iconos y no tiene por qué.
 */
export function toAggregatedVariable(read: AdoptionRead): AggregatedVariable {
  return {
    kind: read.kind,
    key: read.variableKey,
    slotGroup: read.slotGroup,
    itemId: read.itemId,
    itemName: read.itemName,
    talentTree: read.talentTree,
    talentId: read.talentId,
    talentName: read.talentName,
    enchantmentId: read.enchantmentId,
    enchantmentName: read.enchantmentName,
    adoption: {
      value: read.rate,
      users: read.users,
      denominator: read.provenance.denominator,
      unavailable: read.unavailable,
    },
  };
}
