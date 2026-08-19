/**
 * Estadísticos descriptivos compartidos.
 *
 * Viven aquí, y no dentro de player-gap.ts, porque los agregados por segmento
 * (#15) necesitan exactamente los mismos: si la mediana de item level que
 * publica el agregado se calculara distinto que la que compara Player Gap, dos
 * pantallas del producto darían números diferentes sobre la misma población.
 */

/**
 * Percentil por interpolación lineal entre los dos valores vecinos.
 *
 * Interpolación y no "el elemento en la posición redondeada": con muestras
 * pequeñas —que son la norma en las specs de tanque— el redondeo salta de un
 * valor observado a otro y el percentil se mueve a escalones, dando la
 * impresión de un cambio en la población cuando solo ha entrado un jugador.
 *
 * `p` va en [0,1]. Devuelve null con la muestra vacía: no hay percentil de la
 * nada, y un 0 se leería como un valor medido.
 */
export function percentile(values: readonly number[], p: number): number | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(Math.max(p, 0), 1);
  const lowIndex = Math.floor(position);
  const highIndex = Math.ceil(position);

  const low = sorted[lowIndex];
  const high = sorted[highIndex];
  if (low === undefined || high === undefined) return null;
  if (lowIndex === highIndex) return low;

  return low + (high - low) * (position - lowIndex);
}

/**
 * Mediana, no media: tanto el rating como el item level tienen cola por abajo
 * (personajes que acaban de empezar la temporada) y una media se dejaría
 * arrastrar por ella.
 */
export function median(values: readonly number[]): number | null {
  return percentile(values, 0.5);
}
