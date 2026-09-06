/**
 * Qué separa a un escalón del siguiente, calculado sobre variables **ya
 * agregadas** (docs/product-plan.md §13.3, ADR 0027).
 *
 * `biggestGearDifferences()` responde a la misma pregunta, pero pide las dos
 * poblaciones enteras: un `PlayerBuild[]` por segmento, reconstruido desde
 * `character_snapshots` y `character_snapshot_gear`. Eso lo puede hacer el
 * pipeline y no lo puede hacer la web, que lee filas de `aggregate_snapshots`
 * (ADR 0014). Sin esta función, el `adoption_rate` publicado por segmento no
 * alimenta a nadie, que es justo lo que §16 dice que tiene que hacer.
 *
 * El resultado es el mismo número por las dos vías, y hay un test que lo
 * comprueba: si divergieran, el porcentaje que se publica y el que se compara
 * dejarían de describir la misma población.
 *
 * Lo que este módulo NO hace: no mira quién es el jugador. Compara dos
 * segmentos. Dónde cae una persona dentro de esa comparación lo decide quien la
 * pinta, con el equipo que ya tiene leído.
 */
import type { AdoptionRate, GearAlignment } from "./player-gap";
import type { AggregatedVariable } from "./aggregates";
import { COSMETIC_SLOTS, DEFAULT_TOP_DIFFERENCES, isDiscriminative, slotGroup } from "./player-gap";

/**
 * Una variable que se lleva distinto arriba y abajo.
 *
 * Se guardan las dos adopciones enteras y no solo el delta porque el copy de
 * §13.6 necesita los dos porcentajes **con sus dos denominadores**: una fila que
 * solo llevara "+16 puntos" no se podría enseñar sin recomponer la base, y
 * recomponerla al pintar es como se acaba pintando un porcentaje pelado.
 */
export interface SegmentDifference {
  /** La variable, tal como venía identificada del agregado. */
  variable: Omit<AggregatedVariable, "adoption">;
  /** Adopción en el segmento objetivo, el de arriba. */
  target: AdoptionRate;
  /** Adopción en el segmento propio. */
  own: AdoptionRate;
  /** target − own, con signo: positivo = más llevado arriba. */
  delta: number;
}

/**
 * El denominador de una familia de variables dentro de un segmento.
 *
 * Todas las filas de un mismo `kind` de una misma corrida se calcularon sobre la
 * misma gente, así que basta con mirar la primera. Se necesita para las
 * variables que **no aparecen** en un segmento: que nadie de 1800-2000 lleve un
 * item es adopción 0 sobre los que sí tenemos leídos, que es un dato, y no una
 * ausencia de dato.
 */
function denominatorOf(variables: readonly AggregatedVariable[]): {
  denominator: number;
  unavailable: number;
} {
  const first = variables[0];
  return {
    denominator: first?.adoption.denominator ?? 0,
    unavailable: first?.adoption.unavailable ?? 0,
  };
}

function absent(base: { denominator: number; unavailable: number }): AdoptionRate {
  return { value: 0, users: 0, ...base };
}

/**
 * Las mayores diferencias entre dos escalones, ya agregados.
 *
 * Reglas heredadas de `biggestGearDifferences()`, y ninguna es cosmética:
 *
 * - **Los candidatos son las variables del segmento objetivo.** El producto
 *   describe lo que lleva el escalón de arriba, no cataloga lo que lleva el de
 *   abajo y allí falta.
 * - **Solo pasan las que superan `isDiscriminative()`.** Si hay menos de `top`,
 *   la lista sale más corta: no se rellena con diferencias pequeñas para cuadrar
 *   el número (§13.5). Una lista corta es un resultado.
 * - **El orden es estable**, con desempate por clave, para que el mismo agregado
 *   dé siempre la misma lista.
 *
 * Las dos listas deben ser de la misma familia de variable: mezclar gear y
 * talentos en un mismo ranking compararía adopciones calculadas sobre
 * denominadores distintos como si fueran la misma escala.
 */
export function biggestDifferences(
  own: readonly AggregatedVariable[],
  target: readonly AggregatedVariable[],
  options: { top?: number } = {},
): SegmentDifference[] {
  const ownBase = denominatorOf(own);
  const ownByKey = new Map(own.map((variable) => [variable.key, variable]));

  const differences: SegmentDifference[] = [];
  for (const variable of target) {
    const { adoption: targetAdoption, ...identity } = variable;
    const ownAdoption = ownByKey.get(variable.key)?.adoption ?? absent(ownBase);
    const delta = targetAdoption.value - ownAdoption.value;
    if (!isDiscriminative(delta)) continue;

    differences.push({ variable: identity, target: targetAdoption, own: ownAdoption, delta });
  }

  differences.sort(
    (a, b) => Math.abs(b.delta) - Math.abs(a.delta) || a.variable.key.localeCompare(b.variable.key),
  );

  return differences.slice(0, Math.max(options.top ?? DEFAULT_TOP_DIFFERENCES, 0));
}

/**
 * El solapamiento de gear calculado sobre **agregados**, no sobre poblaciones.
 *
 * Es la misma cifra que `gearAlignment()` —la media de la adopción que tienen
 * los items del jugador en el segmento de arriba— por la vía que la web sí
 * puede recorrer: allí no hay `PlayerBuild[]` de nadie, hay filas de
 * `aggregate_snapshots` (ADR 0014). Hay un test de paridad entre las dos, por
 * la misma razón que lo hay para `biggestDifferences()`.
 *
 * Se conservan las tres reglas de la versión de población, y ninguna es
 * cosmética:
 *
 * - **Los slots cosméticos no cuentan.** Un tabardo no es una elección de
 *   rendimiento y su adopción sería ruido con forma de insight.
 * - **Solo cuentan los grupos de slot que el objetivo tiene observados.** De un
 *   hueco del que no sabemos nada arriba no se puede medir ninguna adopción, y
 *   contarlo como 0 hundiría la media con una ausencia de dato (regla 5).
 * - **Un item que arriba no lleva nadie sí cuenta, y cuenta 0.** Eso no es dato
 *   ausente: es dato que dice que nadie lo lleva.
 */
export function gearOverlap(
  playerItems: readonly { slot: string; itemId: number }[],
  target: readonly AggregatedVariable[],
): GearAlignment {
  const adoptionByKey = new Map(target.map((variable) => [variable.key, variable.adoption.value]));
  const groups = new Set(
    target.flatMap((variable) => (variable.slotGroup === null ? [] : [variable.slotGroup])),
  );

  // Dos anillos iguales cuentan una vez, igual que en `comparableItemsByGroup()`:
  // la pregunta es "¿lleva este item en alguno de sus huecos?", y responderla dos
  // veces le daría a ese item doble peso en la media.
  const keys = new Set<string>();
  for (const item of playerItems) {
    if (COSMETIC_SLOTS.includes(item.slot)) continue;
    const group = slotGroup(item.slot);
    if (!groups.has(group)) continue;
    keys.add(`${group}:${item.itemId}`);
  }

  let total = 0;
  for (const key of keys) total += adoptionByKey.get(key) ?? 0;

  return { score: keys.size === 0 ? null : total / keys.size, comparedItems: keys.size };
}
