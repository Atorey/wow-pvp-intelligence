import type { RatingPoint } from "@wowpvp/core";

/**
 * La geometría del gráfico de rating, sin nada que pintar.
 *
 * Todo sale en porcentaje del área del trazo —`x` desde la izquierda, `y` desde
 * arriba— y no en píxeles, porque el gráfico no tiene un ancho: ocupa lo que le
 * deja la columna, del móvil al escritorio. El SVG se estira con
 * `preserveAspectRatio="none"` y los puntos y las etiquetas son HTML colocado en
 * esos mismos porcentajes, que es lo que mantiene el texto a su tamaño en vez de
 * encogerlo con el dibujo.
 */
export interface RatingChartGeometry {
  /** Los puntos, en orden de fecha. */
  points: PlottedPoint[];
  /** Las marcas del eje vertical: valores redondos que abarcan la serie entera. */
  yTicks: { value: number; y: number }[];
  /** Las del eje horizontal, repartidas en el tiempo y no entre las observaciones. */
  xTicks: { at: Date; x: number }[];
  /** El índice del punto más alto: el que la ficha llama "máximo observado". */
  peakIndex: number;
}

export interface PlottedPoint extends RatingPoint {
  x: number;
  y: number;
}

/**
 * Los pasos del eje vertical, de menor a mayor. Todos redondos a la manera en
 * que se habla del rating: nadie dice "subí 37", dice "subí 50".
 */
const Y_STEPS = [25, 50, 100, 200, 250, 500] as const;

/**
 * El último paso, aparte para que el tipo sepa que existe. Con cuatro
 * intervalos abarca 4.000 puntos de rating: más de lo que separa a cualquiera
 * de sí mismo en una temporada.
 */
const LARGEST_Y_STEP = 1000;

/** Intervalos del eje vertical como mucho: con más, las etiquetas se amontonan en el móvil. */
const MAX_Y_INTERVALS = 4;

const DAY_MS = 86_400_000;

/**
 * La geometría de una serie. Pide al menos dos puntos: con uno no hay evolución
 * que dibujar, y quien llama lo cuenta con una frase en vez de un gráfico.
 */
export function ratingChartGeometry(series: readonly RatingPoint[]): RatingChartGeometry {
  if (series.length < 2) {
    throw new Error("Un gráfico de evolución necesita al menos dos observaciones.");
  }

  const ratings = series.map((point) => point.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const step =
    Y_STEPS.find((candidate) => Math.ceil((max - min) / candidate) <= MAX_Y_INTERVALS) ??
    LARGEST_Y_STEP;
  let low = Math.floor(min / step) * step;
  let high = Math.ceil(max / step) * step;
  // Una serie plana no puede quedar pegada a un borde: se abre un paso a cada
  // lado para que la línea caiga en medio y se lea como "no se movió".
  if (high === low) {
    low -= step;
    high += step;
  }

  const start = series[0]?.at.getTime() ?? 0;
  const end = series[series.length - 1]?.at.getTime() ?? start;
  const span = end - start;

  const toX = (time: number): number => (span === 0 ? 50 : ((time - start) / span) * 100);
  const toY = (rating: number): number => ((high - rating) / (high - low)) * 100;

  const points = series.map((point) => ({
    ...point,
    x: toX(point.at.getTime()),
    y: toY(point.rating),
  }));

  const yTicks: { value: number; y: number }[] = [];
  for (let value = low; value <= high; value += step) yTicks.push({ value, y: toY(value) });

  // Dos marcas (principio y fin) para una serie de pocos días, y hasta cuatro
  // para una temporada: más fechas no caben en el móvil sin pisarse.
  const count = span < 4 * DAY_MS ? 2 : span < 21 * DAY_MS ? 3 : 4;
  const xTicks = Array.from({ length: count }, (_, index) => {
    const time = start + (span * index) / (count - 1);
    return { at: new Date(time), x: toX(time) };
  });

  // El último de los empatados en el máximo: si volvió a tocar su techo, lo que
  // interesa marcar es cuándo fue la última vez.
  let peakIndex = 0;
  points.forEach((point, index) => {
    if (point.rating >= (points[peakIndex]?.rating ?? -Infinity)) peakIndex = index;
  });

  return { points, yTicks, xTicks, peakIndex };
}

/**
 * Qué puntos llevan marca.
 *
 * Con pocas observaciones van todas, porque cada una es un dato y la línea entre
 * ellas es solo una unión. Con muchas, las marcas se funden en una línea gruesa
 * que no deja leer nada; entonces se marcan solo el principio, el final y el
 * máximo, y el resto lo lleva la línea y la tabla de debajo.
 */
export const MAX_MARKED_POINTS = 60;

export function markedPoints(geometry: RatingChartGeometry): PlottedPoint[] {
  const { points, peakIndex } = geometry;
  if (points.length <= MAX_MARKED_POINTS) return points;

  const keep = new Set([0, points.length - 1, peakIndex]);
  return points.filter((_, index) => keep.has(index));
}
