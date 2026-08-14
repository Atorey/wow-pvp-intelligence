import type { RatingSegment } from "./types";

/**
 * Segmentación de rating (docs/product-plan.md §27).
 *
 * Los límites NO se hardcodean de forma permanente: la distribución de rating
 * cambia entre temporadas (soft reset), así que la escala es un parámetro
 * explícito. El default de 200 puntos es el punto de partida del plan, no una
 * verdad — cuando se revise por temporada, se cambia aquí y se recalculan los
 * agregados, sin tocar el resto del código.
 */
export interface SegmentScale {
  /** Tamaño del tramo en puntos de rating. */
  size: number;
  /** Suelo: todo lo que esté por debajo cae en el primer tramo. */
  floor: number;
  /** Donde empieza el tramo abierto de arriba: a partir de aquí es "3000+". */
  ceiling: number;
}

export const DEFAULT_SEGMENT_SCALE: SegmentScale = {
  size: 200,
  floor: 0,
  ceiling: 3000,
};

function makeSegment(min: number, max: number): RatingSegment {
  return { min, max, id: `${min}-${max}` };
}

/**
 * Tramo al que pertenece un rating. Semiabierto [min, max): 2000 exacto cae en
 * 2000-2200, no en 1800-2000 — así ningún jugador cuenta en dos segmentos.
 */
export function segmentFor(
  rating: number,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): RatingSegment {
  // El tramo de arriba es abierto: Infinity deja claro que "3000+" no tiene
  // techo, en vez de fingir un máximo que no existe.
  if (rating >= scale.ceiling) return makeSegment(scale.ceiling, Infinity);

  const index = Math.floor((Math.max(rating, scale.floor) - scale.floor) / scale.size);
  const min = scale.floor + index * scale.size;
  return makeSegment(min, min + scale.size);
}

/**
 * El segmento inmediatamente superior: literalmente "el siguiente escalón" del
 * producto. Devuelve undefined si ya está en el tramo abierto de arriba (no hay
 * segmento superior contra el que comparar, ver §13.5 del plan).
 */
export function nextSegment(
  segment: RatingSegment,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): RatingSegment | undefined {
  if (!Number.isFinite(segment.max)) return undefined;
  return segmentFor(segment.max, scale);
}

/**
 * Todos los tramos de una escala, de menor a mayor, incluido el abierto de
 * arriba. Útil para recorrer agregados sin dejarse ninguno fuera.
 */
export function allSegments(scale: SegmentScale = DEFAULT_SEGMENT_SCALE): RatingSegment[] {
  const segments: RatingSegment[] = [];
  for (let min = scale.floor; min < scale.ceiling; min += scale.size) {
    segments.push(segmentFor(min, scale));
  }
  segments.push(segmentFor(scale.ceiling, scale));
  return segments;
}

/** Etiqueta legible: "1800-2000" o "2800+" para el tramo abierto. */
export function formatSegment(segment: RatingSegment): string {
  return Number.isFinite(segment.max) ? `${segment.min}-${segment.max}` : `${segment.min}+`;
}
