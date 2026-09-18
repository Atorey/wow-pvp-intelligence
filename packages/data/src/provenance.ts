import { canShowComparison, confidenceFor } from "@wowpvp/core";
import type { ConfidenceLevel, SnapshotSource } from "@wowpvp/core";

/**
 * De dónde sale una cifra agregada y sobre cuánta gente se calculó.
 *
 * Viaja pegada a la cifra y no como nota al pie porque el principio 8 (§9) —
 * "cada insight trazable a un dato concreto"— no se cumple con una convención.
 * Se cumple cuando no existe forma de devolver el porcentaje sin su
 * denominador, y eso es lo que hace este tipo: no hay lectura de este paquete
 * que entregue una cifra agregada suelta.
 */
export interface Provenance {
  /** `computed_at` de la corrida que produjo la cifra (ADR 0007, decisión 3). */
  computedAt: Date;
  /**
   * Población observada del segmento del que sale la cifra.
   *
   * Es contexto —cuánta gente hay en ese escalón—, nunca la base del cálculo:
   * un segmento de 3.000 personas puede tener cero perfiles con gear.
   */
  sampleSize: number;
  /** Sobre cuántos se calculó **esta** cifra. Es lo único que decide la confianza. */
  denominator: number;
  /** Derivada de `denominator`. Nunca se lee de la base de datos. */
  confidence: ConfidenceLevel;
}

/**
 * Única forma de construir una `Provenance`.
 *
 * `confidence` no es un parámetro: se deriva. `population_segments` tuvo una
 * columna con ese nombre que medía población y no base de comparación —el 20 de
 * agosto de 2026, 59 filas guardadas como `high` con `gear_sample` a cero—, y
 * copiarla al tipo habría convertido esta capa en la puerta por la que se cuela
 * justo lo que prohíbe el punto 3 del ADR 0010. La columna ya no existe
 * (ADR 0033), pero la regla no dependía de que desapareciera: la confianza se
 * calcula desde el denominador de cada cifra, con la función de `packages/core`
 * que ya es la única puerta (ADR 0003).
 */
export function provenanceFor(input: {
  computedAt: Date;
  sampleSize: number;
  denominator: number;
}): Provenance {
  return { ...input, confidence: confidenceFor(input.denominator) };
}

/**
 * Si esta cifra puede enseñarse como comparación.
 *
 * Atajo de `canShowComparison()` sobre el denominador correcto, para que el
 * consumidor no tenga que acordarse de cuál de los dos números mirar.
 */
export function isComparable(provenance: Provenance): boolean {
  return canShowComparison(provenance.denominator);
}

/**
 * De dónde sale una observación individual.
 *
 * No lleva muestra ni confianza, y es deliberado: un snapshot es el dato de una
 * persona, no una estimación sobre una población. Darle `sampleSize: 1` y
 * confianza `insufficient` lo presentaría como una comparación pobre cuando no
 * es una comparación en absoluto — el ADR 0011 (punto 3) separa por este mismo
 * motivo la capa descriptiva de la comparativa.
 *
 * `source` va aquí y no en un margen porque cambia lo que el número significa:
 * `matches_played` del perfil y del leaderboard no son comparables entre sí
 * (ADR 0008), y `search` entra con sesgo de selección (ADR 0006).
 */
export interface ObservationProvenance {
  observedAt: Date;
  source: SnapshotSource;
}
