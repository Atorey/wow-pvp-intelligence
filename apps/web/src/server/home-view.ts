import {
  ALL_SPECS,
  HIGH_RATING_FLOOR,
  canShowComparison,
  isHighRating,
  medianSegmentOf,
  parseShuffleBracket,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import type { BracketPopulation, RunPopulationRead } from "@wowpvp/data";

/**
 * Qué enseñan el bloque «Qué se juega ahora» de la portada y la página del
 * meta, decidido sin tocar la base de datos.
 *
 * Separado de la lectura por lo mismo que `spec-view.ts`: aquí no puede fallar
 * la SQL, puede fallar el denominador. Todas las proporciones de este bloque se
 * calculan sobre la misma corrida y sobre las specs del catálogo, y el corte de
 * quién publica su peso arriba es `canShowComparison()` y no un `if` (regla 2
 * del proyecto).
 *
 * Las dos vistas comparten cálculo y solo se diferencian en el recorte
 * (ADR 0038, consecuencia primera): la portada enseña ocho filas y `/meta` las
 * cuarenta. Si cada una repartiera la modalidad por su cuenta, el día que
 * discreparan la portada diría un porcentaje y su propio enlace otro.
 */

/** Cuántas specs entran en la portada. */
export const TOP_SPECS = 8;

/**
 * Cuántas caben en `/meta`: todas las del catálogo.
 *
 * Es el catálogo y no un número escrito porque el recorte tiene que dejar de
 * recortar solo. Una spec nueva en `ALL_SPECS` entra en la página sin que nadie
 * se acuerde de subir un límite.
 */
export const ALL_SPEC_ROWS = ALL_SPECS.length;

/** El peso de una spec en la modalidad, y qué parte de ese peso está arriba. */
export interface SpecRepresentation {
  spec: SpecEntry;
  /** Personajes observados de la spec en la corrida, sumando sus tramos. */
  observed: number;
  /** Qué parte de lo observado en la modalidad es suyo, en tanto por uno. */
  share: number;
  /**
   * Lo mismo dentro del tramo alto, o `null` si de esta spec no se ha observado
   * arriba gente suficiente.
   *
   * Es `null` y no un cero porque son cosas distintas: cero sería "arriba no hay
   * ninguna", y lo que dice el null es "los que hay no bastan para escribir una
   * proporción". Con él se van las dos cifras que cuelgan de esa base, la
   * proporción y el índice.
   */
  high: {
    observed: number;
    share: number;
    /**
     * `share` de arriba dividido por `share` de la modalidad: cuántas veces
     * pesa la spec arriba lo que pesa en el conjunto. Descriptivo, nunca una
     * medida de lo buena que es (regla 3).
     */
    index: number;
  } | null;
  /**
   * El tramo donde cae la persona de en medio de esta spec: `rating_distribution`
   * de la §17 dicha en una celda.
   *
   * Es `null` cuando la corrida no reparte a nadie por tramos, que con población
   * observada no debería pasar, pero la lectura no lo garantiza y un tramo
   * inventado sería peor que una celda vacía.
   */
  medianSegment: RatingSegment | null;
}

export interface RepresentationBoard {
  /** La corrida de la que salen todas las cifras del bloque. */
  computedAt: Date;
  seasonId: number;
  /** Lo observado en la modalidad: el denominador de «De la ladder». */
  observed: number;
  /** Lo observado de la modalidad en el tramo alto: el denominador de «De 2400+». */
  highObserved: number;
  /** El suelo del tramo alto, para escribirlo donde se nombra. */
  highFloor: number;
  /** De mayor a menor población, recortadas a las que quepan donde se pinten. */
  rows: SpecRepresentation[];
  /** Cuántas specs trae la corrida: las filas son un recorte de estas. */
  specs: number;
}

/**
 * El reparto de la modalidad entre sus specs, o `null` si la corrida no tiene a
 * nadie observado.
 *
 * Solo cuentan los brackets que son una spec del catálogo: `shuffle-overall` y
 * cualquier bracket que Blizzard publique y nosotros no conozcamos inflarían el
 * total y encogerían el peso de todas las demás.
 */
export function representationFor(
  run: RunPopulationRead | null,
  options: { limit?: number } = {},
): RepresentationBoard | null {
  if (!run) return null;

  const specs = run.brackets.flatMap((entry) => {
    const spec = parseShuffleBracket(entry.bracket);
    return spec && entry.population > 0 ? [{ spec, entry }] : [];
  });

  const observed = total(specs.map(({ entry }) => entry.population));
  if (observed === 0) return null;

  const highObserved = total(specs.map(({ entry }) => highPopulationOf(entry)));

  return {
    computedAt: run.computedAt,
    seasonId: run.seasonId,
    observed,
    highObserved,
    highFloor: HIGH_RATING_FLOOR,
    specs: specs.length,
    rows: specs
      .map(({ spec, entry }) => representationOf(spec, entry, { observed, highObserved }))
      // El empate se deshace por la etiqueta y no por el orden en que llegó la
      // corrida: dos specs con la misma población tienen que salir siempre en
      // el mismo orden, o la portada se reordena sola entre dos visitas.
      .sort((a, b) => b.observed - a.observed || a.spec.label.localeCompare(b.spec.label))
      .slice(0, options.limit ?? TOP_SPECS),
  };
}

function representationOf(
  spec: SpecEntry,
  entry: BracketPopulation,
  bases: { observed: number; highObserved: number },
): SpecRepresentation {
  const observed = entry.population;
  const share = observed / bases.observed;
  const high = highPopulationOf(entry);
  // La mediana se calcula fuera del umbral del tramo alto: describe a toda la
  // población de la spec, no a la de arriba, así que no se cae con ella.
  const row = { spec, observed, share, medianSegment: medianSegmentOf(entry.segments) };

  // El umbral se pregunta por la muestra de **esta** spec arriba, que es sobre
  // quien se calcularía la cifra. Con el total de la modalidad se publicarían
  // proporciones de specs con cuatro personajes observados en el tramo.
  if (!canShowComparison(high) || bases.highObserved === 0) {
    return { ...row, high: null };
  }

  const highShare = high / bases.highObserved;
  return { ...row, high: { observed: high, share: highShare, index: highShare / share } };
}

/** Lo observado de un bracket a partir del suelo del tramo alto. */
function highPopulationOf(entry: BracketPopulation): number {
  return total(
    entry.segments.filter((row) => isHighRating(row.segmentMin)).map((row) => row.population),
  );
}

function total(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0);
}
