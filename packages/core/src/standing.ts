import { MIN_SAMPLE_MEDIUM } from "./confidence";

/**
 * Dónde cae un rating dentro de la población observada de su bracket.
 *
 * Vive aquí y no en la capa de lectura ni en la web porque es una regla de
 * producto con umbral, exactamente lo que la regla 2 del proyecto manda tener en
 * un solo sitio (Consecuencias del ADR 0011). No sirve la `percentile()` de
 * stats.ts: esa da el valor que ocupa un percentil dado, y aquí hace falta lo
 * contrario.
 *
 * Es un recuento, no una inferencia: contar cuántos observados están por debajo
 * de un rating no estima nada sobre una población mayor, así que **no pasa por
 * `canShowComparison()`** (punto 3 del ADR 0011). El umbral que sí aplica es
 * otro y solo decide una cosa: si además de la fracción se puede escribir un
 * porcentaje.
 */
export interface Standing {
  /** Cuántos personajes se han observado en el bracket esta temporada. */
  observed: number;
  /** Cuántos de ellos están por debajo del rating consultado. */
  below: number;
  /**
   * Percentil, o `null` por debajo de `MIN_SAMPLE_MEDIUM` observados.
   *
   * Punto 4 del ADR 0011: por debajo se enseña la fracción y no el porcentaje.
   * "3 de 6 observados" es honesto; "percentil 50" sobre 6 personas es la misma
   * cifra disfrazada de estadística.
   */
  percentile: number | null;
}

/**
 * El recuento crudo viaja **junto** al percentil, y no se devuelve el porcentaje
 * suelto, porque la fracción manda y el porcentaje acompaña (§2.5 del brief).
 * Una función que devolviera solo el percentil invitaría a pintarlo solo.
 */
export function standingWithin(counts: { observed: number; below: number }): Standing {
  const percentile =
    counts.observed < MIN_SAMPLE_MEDIUM ? null : (counts.below / counts.observed) * 100;
  return { observed: counts.observed, below: counts.below, percentile };
}
