/**
 * Agregados por segmento de población (docs/product-plan.md §27 y §28, #15).
 *
 * §27 define dos entidades derivadas de los snapshots: `PopulationSegment` —el
 * escalón (temporada, bracket, spec, rango de rating) con su tamaño y su forma—
 * y `AggregateSnapshot` —el adoption_rate de cada variable dentro de ese
 * escalón—. Aquí viven las dos como funciones puras; el job de pipeline solo
 * carga población, llama a esto y escribe filas.
 *
 * Puro y en core, no en el pipeline, por la misma razón que Player Gap: la web
 * de Phase 2 lee estos agregados y tiene que poder recalcularlos igual. Un
 * adoption_rate que se calculara distinto al publicarlo y al compararlo daría
 * dos números para la misma población.
 *
 * Lo que este módulo NO decide:
 *
 * - **Quién está activo.** Recibe la población ya filtrada por ventana de
 *   actividad; la ventana es un parámetro del llamante, que además la guarda
 *   junto al resultado (§27, "Active Players").
 * - **Qué se enseña.** Aquí se agrega todo lo observado, incluidos los
 *   segmentos con muestra insuficiente: guardar no es mostrar. La puerta sigue
 *   siendo `canShowComparison()` en el consumidor — necesitamos la fila con
 *   n=12 precisamente para saber cuánto le falta a esa spec para llegar a 30.
 */
import { confidenceFor } from "./confidence";
import {
  comparableItemsByGroup,
  hasComparableGear,
  type AdoptionRate,
  type PlayerBuild,
} from "./player-gap";
import { median, percentile } from "./stats";
import type { ConfidenceLevel } from "./types";

/**
 * Tipos de variable agregada.
 *
 * Es un conjunto cerrado a propósito: son las dos que el schema de hoy puede
 * observar. Stats secundarias y embellishments (§13.1) no están porque
 * `character_snapshot_gear` no las guarda, y los nodos de talento sueltos
 * esperan a #24. Añadir una variable es añadir aquí un valor y en la migración
 * un check — no hay un cajón genérico donde meter cualquier cosa sin decidirlo.
 */
export type AggregateVariableKind = "gear-item" | "talent-code";

/** El adoption_rate de una variable dentro de un segmento (§13.2). */
export interface AggregatedVariable {
  kind: AggregateVariableKind;
  /** Clave estable dentro del segmento: "TRINKET:207581" o el código de talentos. */
  key: string;
  /** Grupo de slots normalizado ('TRINKET', no 'TRINKET_1'). null en talentos. */
  slotGroup: string | null;
  /** item_id, para que el llamante pueda resolver el nombre. null en talentos. */
  itemId: number | null;
  adoption: AdoptionRate;
}

/** La forma de un segmento: cuánta gente hay y cómo se reparte (§27). */
export interface SegmentSummary {
  /** Personajes activos del segmento. Es el n que sostiene la confianza (ADR 0003). */
  sampleSize: number;
  confidence: ConfidenceLevel;
  ratingMedian: number | null;
  ratingP25: number | null;
  ratingP75: number | null;
  ratingMin: number | null;
  ratingMax: number | null;
  /** Mediana del item level **equipado** (ver PlayerBuild.equippedItemLevel). */
  equippedItemLevelMedian: number | null;
  /**
   * Denominadores reales de cada bloque de variables, que casi nunca coinciden
   * con `sampleSize`: el rating llega del leaderboard para todo el mundo, pero
   * gear, talentos e item level solo existen donde hemos bajado el perfil
   * completo. Se guardan para que un adoption_rate del 60% no pueda leerse como
   * "60% del segmento" cuando en realidad es "60% de los 40 perfiles que
   * tenemos de un segmento de 3.000".
   */
  itemLevelSample: number;
  gearSample: number;
  talentSample: number;
}

export function summarizeSegment(population: readonly PlayerBuild[]): SegmentSummary {
  const ratings = population.map((member) => member.rating);
  const itemLevels = population
    .map((member) => member.equippedItemLevel)
    .filter((level): level is number => level !== null);

  return {
    sampleSize: population.length,
    confidence: confidenceFor(population.length),
    ratingMedian: median(ratings),
    ratingP25: percentile(ratings, 0.25),
    ratingP75: percentile(ratings, 0.75),
    ratingMin: percentile(ratings, 0),
    ratingMax: percentile(ratings, 1),
    equippedItemLevelMedian: median(itemLevels),
    itemLevelSample: itemLevels.length,
    gearSample: population.filter(hasComparableGear).length,
    talentSample: population.filter((member) => member.talentLoadoutCode !== null).length,
  };
}

/**
 * adoption_rate de cada item observado, por grupo de slots.
 *
 * Una sola pasada contando, en vez de llamar a `slotItemAdoption` por item: con
 * 40 brackets × segmentos × cientos de items, recorrer la población entera una
 * vez por item convierte el recálculo diario en minutos de CPU para dar
 * exactamente el mismo número (hay un test que lo comprueba contra la función
 * de Player Gap, para que las dos no puedan divergir en silencio).
 *
 * Los perfiles sin equipo legible salen del denominador y se cuentan como
 * `unavailable` (regla 5 del proyecto): un personaje del que solo tenemos la
 * fila de leaderboard no es alguien que "no lleva ese item".
 */
export function aggregateGearItems(population: readonly PlayerBuild[]): AggregatedVariable[] {
  const usersByGroup = new Map<string, Map<number, number>>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    if (!hasComparableGear(member)) {
      unavailable++;
      continue;
    }
    denominator++;

    for (const [group, items] of comparableItemsByGroup(member)) {
      let counts = usersByGroup.get(group);
      if (!counts) {
        counts = new Map<number, number>();
        usersByGroup.set(group, counts);
      }
      for (const itemId of items) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
  }

  const variables: AggregatedVariable[] = [];
  for (const [group, counts] of [...usersByGroup].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [itemId, users] of [...counts].sort((a, b) => a[0] - b[0])) {
      variables.push({
        kind: "gear-item",
        key: `${group}:${itemId}`,
        slotGroup: group,
        itemId,
        adoption: { value: users / denominator, users, denominator, unavailable },
      });
    }
  }
  return variables;
}

/**
 * adoption_rate de cada `talent_loadout_code` observado.
 *
 * Sigue siendo coincidencia exacta del código completo, con la limitación de
 * siempre: dos builds que difieran en un solo nodo cuentan como distintas, así
 * que en la mayoría de specs esto describe una población muy dividida y no una
 * "build del segmento" (#24). Se agrega igualmente porque el reparto de códigos
 * es en sí el dato que mide esa división, y porque cuando #24 decodifique los
 * nodos hará falta el histórico para saber desde cuándo.
 */
export function aggregateTalentCodes(population: readonly PlayerBuild[]): AggregatedVariable[] {
  const counts = new Map<string, number>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    const code = member.talentLoadoutCode;
    if (code === null) {
      unavailable++;
      continue;
    }
    denominator++;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, users]) => ({
      kind: "talent-code" as const,
      key: code,
      slotGroup: null,
      itemId: null,
      adoption: { value: users / denominator, users, denominator, unavailable },
    }));
}

/**
 * Todas las variables agregables de un segmento.
 *
 * Sin filtro por adopción mínima: se guarda hasta el item que lleva una sola
 * persona. El filtro de §13.5 ("las diferencias pequeñas se ocultan") es una
 * regla de presentación, y aplicarla al guardar impediría calcular después el
 * poder discriminante de §13.3 — que necesita justamente las adopciones bajas
 * para saber qué variable no discrimina. El coste es volumen de filas, y esa es
 * una decisión de retención (#48), no de agregación.
 */
export function aggregateSegment(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return [...aggregateGearItems(population), ...aggregateTalentCodes(population)];
}

/**
 * Reparte una población en segmentos de rating.
 *
 * Recibe la función de segmentación en vez de importarla para que el llamante
 * pueda pasar la escala de la temporada vigente (§27: los límites se revisan
 * por temporada, no se hardcodean permanentemente).
 */
export function groupBySegment<T extends { rating: number }>(
  population: readonly T[],
  segmentOf: (rating: number) => { id: string },
): Map<string, T[]> {
  const bySegment = new Map<string, T[]>();
  for (const member of population) {
    const id = segmentOf(member.rating).id;
    const bucket = bySegment.get(id);
    if (bucket) bucket.push(member);
    else bySegment.set(id, [member]);
  }
  return bySegment;
}
