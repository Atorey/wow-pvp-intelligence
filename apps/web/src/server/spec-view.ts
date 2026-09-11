import {
  COSMETIC_SLOTS,
  GEAR_SLOTS,
  MIN_SAMPLE_MEDIUM,
  canShowComparison,
  confidenceFor,
  parseShuffleBracket,
  slotGroup,
  type ConfidenceLevel,
  type RatingSegment,
} from "@wowpvp/core";
import type { AdoptionRead, RunPopulationRead, SegmentRead } from "@wowpvp/data";

/**
 * Qué enseñan las páginas de spec, decidido sin tocar la base de datos.
 *
 * Separado de las lecturas por la misma razón que `player-profile.ts`: lo que
 * aquí puede salir mal no es la SQL sino elegir el denominador equivocado,
 * poner en la misma cifra dos corridas distintas o llamar "no hay gente" a "no
 * tenemos su equipo". Todo eso se prueba con objetos y sin Postgres delante.
 */

/** Una fila de la tabla por tramo. */
export interface SegmentRowView {
  segment: RatingSegment;
  population: number;
  /** Peso del tramo dentro de la spec, en tanto por uno. */
  share: number;
  /** La ventana con la que se contó **este** tramo: 7 o 14 días (ADR 0007, punto 6). */
  activityWindowDays: number;
  /**
   * Perfiles con gear leído. Es la base de la confianza de la fila, y va en su
   * propia columna al lado de la población para que se vea que no son la misma
   * cifra (ADR 0010, decisión 3).
   */
  gearSample: number;
  confidence: ConfidenceLevel;
}

/** Qué parte de la modalidad es esta spec, y en qué puesto queda. */
export interface SpecStanding {
  rank: number;
  /** Cuántas specs trae la corrida: el "de 40" del puesto. */
  of: number;
  population: number;
  total: number;
  share: number;
}

export interface SpecOverview {
  /** La corrida de la que salen todas las cifras de la página. */
  computedAt: Date;
  /** La suma de los tramos, cada uno contado con su ventana. */
  observed: number;
  highestRating: number | null;
  medianSegment: RatingSegment | null;
  /** `null` cuando no se puede afirmar con la misma corrida que los tramos. */
  standing: SpecStanding | null;
  /** De arriba abajo, que es como se lee una escalera. */
  rows: SegmentRowView[];
}

/**
 * El resumen de una spec en una modalidad, o `null` si no hay nadie observado.
 *
 * Todo sale de las filas de `population_segments` de una sola corrida y de
 * ninguna otra población: una página no puede contar dos poblaciones distintas
 * según el bloque que la pinte (ADR 0011, punto 5). Por eso el total de la
 * cabecera es la suma de la tabla y no un recuento de la temporada, aunque
 * sume tramos contados con ventanas distintas — eso se declara en pantalla.
 */
export function specOverviewFor(input: {
  bracket: string;
  segments: readonly SegmentRead[];
  run: RunPopulationRead | null;
}): SpecOverview | null {
  // Un tramo sin nadie observado no se lista: una fila de ceros no describe a
  // nadie, y los tramos que existen ya los dice la escala.
  const populated = input.segments.filter((row) => row.population.sampleSize > 0);
  const first = populated[0];
  if (!first) return null;

  const observed = total(populated.map((row) => row.population.sampleSize));
  const maxima = populated.flatMap((row) => (row.rating.max === null ? [] : [row.rating.max]));
  // Cualquier procedencia de cualquier fila sirve: `readBracketSegments` las
  // trae todas de la misma corrida.
  const computedAt = first.gear.computedAt;

  return {
    computedAt,
    observed,
    highestRating: maxima.length > 0 ? Math.max(...maxima) : null,
    medianSegment: medianSegment(populated),
    standing: standingIn(input.run, input.bracket, computedAt),
    rows: [...populated]
      .sort((a, b) => b.segment.min - a.segment.min)
      .map((row) => ({
        segment: row.segment,
        population: row.population.sampleSize,
        share: row.population.sampleSize / observed,
        activityWindowDays: row.activityWindowDays,
        gearSample: row.gear.denominator,
        // La de la procedencia del gear, que ya sale de su denominador con
        // `confidenceFor()`. La columna `confidence` de la tabla mide
        // población y ni siquiera se lee (ADR 0014, decisión 6).
        confidence: row.gear.confidence,
      })),
  };
}

/**
 * El tramo donde cae el personaje del medio.
 *
 * Es lo que se puede decir de la mediana con lo que hay guardado: cada tramo
 * guarda la suya, pero la de la spec entera no se deduce de ellas. El tramo que
 * la contiene sí, y con exactitud, contando de abajo arriba hasta pasar la
 * mitad. Con un total par se toma la mediana baja, que cae dentro de un tramo
 * en vez de entre dos.
 */
export function medianSegment(segments: readonly SegmentRead[]): RatingSegment | null {
  const ascending = segments
    .filter((row) => row.population.sampleSize > 0)
    .sort((a, b) => a.segment.min - b.segment.min);
  const count = total(ascending.map((row) => row.population.sampleSize));

  let cumulative = 0;
  for (const row of ascending) {
    cumulative += row.population.sampleSize;
    if (cumulative * 2 >= count) return row.segment;
  }
  return null;
}

/**
 * El puesto de la spec en la modalidad.
 *
 * Solo se afirma si los tramos de la página salen de la misma corrida que el
 * total. `readBracketSegments` trae la corrida más reciente **de ese bracket**,
 * y si la última de la región no lo incluyó —nadie activo en la ventana— serían
 * dos fechas en una misma cifra: la población de un día sobre el total de otro.
 * Se calla en vez de mezclarlas.
 *
 * El puesto se cuenta entre las specs del catálogo: un bracket que
 * `parseShuffleBracket` no reconoce no es una spec, y contarlo inflaría el "de 40".
 */
function standingIn(
  run: RunPopulationRead | null,
  bracket: string,
  computedAt: Date,
): SpecStanding | null {
  if (!run || run.computedAt.getTime() !== computedAt.getTime()) return null;

  const specs = run.brackets
    .filter((entry) => parseShuffleBracket(entry.bracket) !== undefined)
    .sort((a, b) => b.population - a.population || a.bracket.localeCompare(b.bracket));
  const index = specs.findIndex((entry) => entry.bracket === bracket);
  const own = specs[index];
  const all = total(specs.map((entry) => entry.population));
  if (!own || all === 0) return null;

  return {
    rank: index + 1,
    of: specs.length,
    population: own.population,
    total: all,
    share: own.population / all,
  };
}

/**
 * Una familia de adopciones: listada sobre una base suficiente, o su ausencia
 * con la cifra que tiene y la que le falta.
 *
 * Son dos estados y no una lista que puede venir vacía por lo mismo que en la
 * caja Player Gap: "no hay base" y "no hay filas" se dicen distinto, y una
 * lista recortada o en gris sería el relleno que la §1.5 del brief prohíbe.
 */
export type Listing<T> =
  | {
      state: "listed";
      confidence: Extract<ConfidenceLevel, "high" | "medium">;
      /** La base de la familia en el escalón: la que decide si se enseña. */
      sample: number;
      /** Cuántos quedaron fuera del denominador por no tener el dato (regla 5). */
      unavailable: number;
      content: T;
    }
  | {
      state: "insufficient";
      sample: number;
      needed: number;
      /**
       * Si lo que falta es gente en el tramo o nuestro muestreo de la que hay.
       * Se dicen distinto, como en la caja Player Gap: echarle al juego la
       * culpa de nuestro muestreo es la mentira fácil (§1.5 del brief).
       */
      cause: "population" | "sampling";
    };

/** Un hueco de equipo con sus items, de más a menos llevado. */
export interface SlotView {
  /** El grupo con el que se agregó: `'TRINKET'`, no `'TRINKET_1'`. */
  group: string;
  /** Si el grupo junta dos huecos, que es algo que se dice en pantalla. */
  paired: boolean;
  rows: AdoptionRead[];
}

export interface GearContent {
  slots: SlotView[];
  gems: AdoptionRead[];
  enchants: AdoptionRead[];
}

/** Los nodos de uno de los tres árboles del loadout. */
export interface TreeView {
  tree: (typeof TREES)[number];
  rows: AdoptionRead[];
}

export interface BuildContent {
  heroTrees: AdoptionRead[];
  trees: TreeView[];
}

export interface SegmentDetail {
  segment: SegmentRead;
  /** La mediana de item level, solo con base suficiente para enseñarla. */
  itemLevel: { median: number; sample: number } | null;
  gear: Listing<GearContent>;
  /** Nodos y árbol de héroe: los dos salen del loadout (ADR 0026). */
  build: Listing<BuildContent>;
  pvp: Listing<AdoptionRead[]>;
}

/** Las adopciones de un escalón, cada familia leída por separado. */
export interface SegmentAdoptions {
  gear: readonly AdoptionRead[];
  talentNodes: readonly AdoptionRead[];
  heroTrees: readonly AdoptionRead[];
  pvpTalents: readonly AdoptionRead[];
}

/** El orden en que se enseñan los árboles: el de la ventana de talentos del juego. */
const TREES = ["class", "spec", "hero"] as const;

/**
 * Lo que enseña la página de un tramo.
 *
 * Cada familia se decide con **su** base en la fila del escalón —el gear con
 * `gear_sample`, los nodos y el árbol de héroe con `talent_node_sample`, los
 * talentos PvP con `pvp_talent_sample`—, que son las tres con las que el ADR
 * 0029 decide si la página se indexa. Si se decidiera con otras, una página
 * podría entrar en Google por sus nodos y enseñar solo un "sin comparación".
 *
 * Cada fila, en cambio, se escribe con **su** fracción: el denominador de la
 * variable es sobre quien de verdad se calculó ese porcentaje (ADR 0007,
 * decisión 3), y el del árbol de héroe es menor que el de los nodos porque la
 * API no lo trae en todos los loadouts.
 */
export function segmentDetailFor(input: {
  segment: SegmentRead;
  adoptions: SegmentAdoptions;
}): SegmentDetail {
  const { segment, adoptions } = input;
  const population = segment.population.sampleSize;
  const items = adoptions.gear.filter((row) => row.kind === "gear-item");

  return {
    segment,
    itemLevel: itemLevelOf(segment),
    gear: listingFor(
      { sample: segment.gear.denominator, population, unavailable: unavailableOf(items) },
      () => ({
        slots: slotsFor(items),
        gems: byAdoption(adoptions.gear.filter((row) => row.kind === "gear-gem")),
        enchants: byAdoption(adoptions.gear.filter((row) => row.kind === "gear-enchant")),
      }),
    ),
    build: listingFor(
      {
        sample: segment.talentNodes.denominator,
        population,
        unavailable: unavailableOf(adoptions.talentNodes),
      },
      () => ({
        heroTrees: byAdoption(adoptions.heroTrees),
        trees: TREES.map((tree) => ({
          tree,
          rows: byAdoption(adoptions.talentNodes.filter((row) => row.talentTree === tree)),
        })).filter((view) => view.rows.length > 0),
      }),
    ),
    pvp: listingFor(
      {
        sample: segment.pvpTalents.denominator,
        population,
        unavailable: unavailableOf(adoptions.pvpTalents),
      },
      () => byAdoption(adoptions.pvpTalents),
    ),
  };
}

function listingFor<T>(
  bases: { sample: number; population: number; unavailable: number },
  content: () => T,
): Listing<T> {
  const { sample, population, unavailable } = bases;
  if (!canShowComparison(sample)) {
    return {
      state: "insufficient",
      sample,
      needed: MIN_SAMPLE_MEDIUM,
      // Con gente de sobra en el tramo, lo que falta es leerla. El umbral es el
      // mismo porque la pregunta es la misma: ¿hay a quién describir?
      cause: canShowComparison(population) ? "sampling" : "population",
    };
  }
  // El `insufficient` ya salió arriba; el tipo lo estrecha aquí para que quien
  // pinte no tenga que volver a preguntarse por un estado imposible.
  const confidence = confidenceFor(sample);
  return {
    state: "listed",
    confidence: confidence === "high" ? "high" : "medium",
    sample,
    unavailable,
    content: content(),
  };
}

/**
 * La mediana de item level, con su propia base: sale de `item_level_sample` y
 * no del `gear_sample`, y el día que no coincidan manda la suya.
 */
function itemLevelOf(segment: SegmentRead): SegmentDetail["itemLevel"] {
  const median = segment.equippedItemLevelMedian;
  if (median === null || !canShowComparison(segment.itemLevel.denominator)) return null;
  return { median, sample: segment.itemLevel.denominator };
}

/**
 * Los items agrupados por hueco, en el orden de la ficha del personaje.
 *
 * El grupo se vuelve a pasar por `slotGroup()` aunque la fila ya lo traiga
 * normalizado: es la función con la que se agregó, y así un `TRINKET_1` que
 * llegara crudo cae en su grupo en vez de abrir otro con la mitad de la
 * adopción. Los cosméticos no se pintan: no son una elección de rendimiento.
 */
function slotsFor(rows: readonly AdoptionRead[]): SlotView[] {
  const byGroup = new Map<string, AdoptionRead[]>();
  for (const row of rows) {
    if (row.slotGroup === null) continue;
    const group = slotGroup(row.slotGroup);
    if (COSMETIC_SLOTS.includes(group)) continue;

    const list = byGroup.get(group);
    if (list) list.push(row);
    else byGroup.set(group, [row]);
  }

  return [...byGroup]
    .map(([group, list]) => ({ group, paired: slotsIn(group) > 1, rows: byAdoption(list) }))
    .sort((a, b) => positionOf(a.group) - positionOf(b.group) || a.group.localeCompare(b.group));
}

/**
 * La posición de un grupo: la de su primer hueco en la ficha. Uno que el
 * catálogo no conoce va al final en vez de perderse, como en `compareGearSlots`.
 */
function positionOf(group: string): number {
  const index = GEAR_SLOTS.findIndex((slot) => slotGroup(slot) === group);
  return index === -1 ? GEAR_SLOTS.length : index;
}

function slotsIn(group: string): number {
  return GEAR_SLOTS.filter((slot) => slotGroup(slot) === group).length;
}

function byAdoption(rows: readonly AdoptionRead[]): AdoptionRead[] {
  return [...rows].sort((a, b) => b.rate - a.rate || a.variableKey.localeCompare(b.variableKey));
}

/** De la primera fila: todas las de una familia comparten el recuento de fuera. */
function unavailableOf(rows: readonly AdoptionRead[]): number {
  return rows[0]?.unavailable ?? 0;
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
