import { canShowComparison } from "./confidence";
import { DEFAULT_SEGMENT_SCALE, nextSegment, type SegmentScale } from "./segments";
import type { RatingSegment } from "./types";

/**
 * Contra qué escalón se compara a un jugador (ADR 0051).
 *
 * El objetivo era siempre el inmediato, y si no tenía base no había comparación
 * (decisión 7 del ADR 0011). Medido el 15 de octubre de 2026, eso dejaba sin
 * nada a todo el que juega por debajo de 1400 y a casi todo el que juega por
 * encima de 2200, que es donde la base no llega aunque haya gente. Ahora hay
 * tres formas de tener objetivo, en este orden, y cada una se declara en la
 * caja porque cambia lo que significan las cifras:
 *
 * - `next`: el inmediato, como siempre. Es la promesa del producto.
 * - `skipped`: el inmediato no tiene base y algún tramo de encima sí. Es el
 *   servible más cercano, a la distancia que esté, y la caja dice cuántos
 *   tramos ha saltado: a 800 contra 1800 la distancia es parte del dato.
 * - `peers`: por encima no hay ningún tramo con base, o no hay tramo encima. Se
 *   compara con el propio, que es otra pregunta —en qué te diferencias de tus
 *   pares— y se dice así.
 *
 * `none` es no tener ninguna de las tres. Lleva el inmediato porque es el que
 * explica la ausencia: "1400-1600 no tiene muestra" es lo que hay que leer.
 */
export type ComparisonTarget =
  | { mode: "next"; segment: RatingSegment }
  | {
      mode: "skipped";
      segment: RatingSegment;
      /** Los tramos sin base entre el de quien mira y el objetivo, de abajo arriba. */
      skipped: readonly RatingSegment[];
    }
  | { mode: "peers"; segment: RatingSegment }
  | { mode: "none"; next: RatingSegment | undefined };

export type ComparisonMode = Exclude<ComparisonTarget["mode"], "none">;

/** Los modos con objetivo, en el orden en que se prueban. */
export const COMPARISON_MODES: readonly ComparisonMode[] = ["next", "skipped", "peers"];

/**
 * El objetivo de un jugador, decidido con la base de comparación de cada tramo.
 *
 * Lo que decide si un tramo tiene base es el mismo `canShowComparison()` sobre
 * su `gear_sample`, nunca sobre su población (decisión 3 del ADR 0010), y se
 * aplica aquí y no en quien llama para que el umbral siga teniendo un único
 * sitio (regla 2). `gearSampleOf` devuelve 0 de un tramo que la corrida no
 * calculó: sin fila no hay base.
 */
export function comparisonTargetFor(
  own: RatingSegment,
  gearSampleOf: (segment: RatingSegment) => number,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): ComparisonTarget {
  const servable = (segment: RatingSegment): boolean => canShowComparison(gearSampleOf(segment));
  const next = nextSegment(own, scale);

  // Los de encima, del más cercano al más lejano: el primero con base es el
  // objetivo, y los que quedan por debajo de él son los que la caja declara.
  const above: RatingSegment[] = [];
  for (let segment = next; segment; segment = nextSegment(segment, scale)) above.push(segment);

  const nearest = above.findIndex(servable);
  const target = above[nearest];
  if (target) {
    if (nearest === 0) return { mode: "next", segment: target };
    return { mode: "skipped", segment: target, skipped: above.slice(0, nearest) };
  }

  if (servable(own)) return { mode: "peers", segment: own };
  return { mode: "none", next };
}
