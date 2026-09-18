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
 * El segmento inmediatamente inferior. Devuelve undefined en el tramo de abajo,
 * que no tiene ninguno debajo por definición de la escala.
 *
 * Existe por el enlazado interno entre escalones que pide §22 del plan: la
 * página de segmento enlaza al anterior y al siguiente, y calcularlo restando
 * `size` en la web reinventaría la escala en un sitio que no la conoce —el
 * primer tramo dejaría de ser un borde y pasaría a ser un número negativo.
 */
export function previousSegment(
  segment: RatingSegment,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): RatingSegment | undefined {
  if (segment.min <= scale.floor) return undefined;
  return segmentFor(segment.min - 1, scale);
}

/**
 * Rating de los jugadores a los que sirve el producto: 1400-2200 (§4 del plan).
 *
 * Vive aquí y no en el job que lo consulta porque decide dónde se gasta la cuota
 * de muestreo (ADR 0010, decisión 5) y, con ella, a quién se le puede enseñar una
 * comparación. Es una regla de producto, no un parámetro de un job.
 */
export const ICP_RATING_RANGE = { min: 1400, max: 2200 } as const;

/**
 * ¿Le sirve este segmento **objetivo** a alguien del ICP?
 *
 * Lo que decide un Player Gap no es el segmento del sujeto sino el del objetivo
 * (ADR 0010), así que la pregunta se hace sobre los sujetos que hay debajo: un
 * segmento objetivo sirve al ICP si el escalón inmediatamente inferior solapa
 * con el rango. 1600-1800 sirve (debajo está 1400-1600); 400-600 no, por muy
 * poblado que esté el fondo de la ladder al empezar la temporada.
 */
export function servesIcpSubjects(
  segment: RatingSegment,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): boolean {
  // Sin nadie debajo no hay sujetos a los que servir, ni en el ICP ni fuera.
  if (segment.min <= scale.floor) return false;

  const below = segmentFor(segment.min - 1, scale);
  return below.max > ICP_RATING_RANGE.min && below.min < ICP_RATING_RANGE.max;
}

/**
 * Dónde empieza "el tramo alto": el rating a partir del cual una población
 * cuenta como la parte alta de la ladder (§17 del plan,
 * `high_rating_representation`).
 *
 * Es una decisión de producto y no un detalle de la portada: de aquí sale el
 * denominador con el que se compara el peso de una spec arriba contra su peso
 * en toda la modalidad, así que moverlo cambia todas esas cifras a la vez. Por
 * eso vive donde la escala y no en quien la pinta.
 *
 * Cae en un borde de la escala a propósito —2400 abre un tramo, no lo parte—,
 * porque lo que se suma son filas de `population_segments` enteras: un corte a
 * mitad de tramo obligaría a repartir una población que no sabemos cómo se
 * reparte por dentro.
 */
export const HIGH_RATING_FLOOR = 2400;

/**
 * ¿Está este tramo dentro de la parte alta? Se pregunta por el suelo del tramo
 * y no por el rating de nadie: la unidad de la que hay población guardada es el
 * tramo.
 */
export function isHighRating(segmentMin: number, floor: number = HIGH_RATING_FLOOR): boolean {
  return segmentMin >= floor;
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
