import type { ActivityWindowDays, RatingSegment, Region } from "@wowpvp/core";
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
 * Cuatro y no una porque son cuatro denominadores que difieren en órdenes de
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
  /** Base de comparación del gear: `gear_sample`. La que decide el Player Gap. */
  gear: Provenance;
  /** Base de comparación de talentos. Separada porque no coincide con la de gear. */
  talents: Provenance;
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
       sample_size, gear_sample, talent_sample, item_level_sample,
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

/** Qué variable se agregó. Las dos que hoy escribe `refresh-aggregates`. */
export type VariableKind = "gear-item" | "talent-code";

/**
 * Un `adoption_rate` con todo lo que hace falta para poder enseñarlo.
 *
 * `users`, `denominator` y `unavailable` viajan crudos además del porcentaje
 * porque §13.5 exige que el tamaño de muestra vaya pegado a cada cifra, no en
 * una nota al pie.
 */
export interface AdoptionRead {
  kind: VariableKind;
  /** Clave de la variable: el `item_id` como texto, o el código de talentos. */
  variableKey: string;
  /** 'TRINKET_1', 'HEAD'… null en las variables que no son de gear. */
  slotGroup: string | null;
  itemId: number | null;
  itemName: string | null;
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
    `select variable_kind, variable_key, slot_group, item_id, item_name,
            users, denominator, unavailable, adoption_rate
       from aggregate_snapshots
      where population_segment_id = $1 and variable_kind = $2
      order by adoption_rate desc, variable_key
      ${options.limit === undefined ? "" : "limit $3"}`,
    options.limit === undefined ? [segment.rowId, kind] : [segment.rowId, kind, options.limit],
  );

  return rows.map((row) => ({
    kind: row.variable_kind,
    variableKey: row.variable_key,
    slotGroup: row.slot_group,
    itemId: row.item_id === null ? null : toNumber(row.item_id),
    itemName: row.item_name,
    users: row.users,
    unavailable: row.unavailable,
    rate: toNumber(row.adoption_rate),
    provenance: provenanceFor({
      computedAt: segment.population.computedAt,
      sampleSize: segment.population.sampleSize,
      denominator: row.denominator,
    }),
  }));
}
