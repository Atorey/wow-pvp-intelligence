/**
 * Cuánto se ha movido una adopción entre dos corridas (§19 del plan,
 * [ADR 0037](../../../docs/decisions/0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md)).
 *
 * El alcance es el que el título de la issue pide y el que los datos aguantan:
 * la **variación de `adoption_rate`** de una variable dentro de un escalón. El
 * criterio anti-FOTM que el cuerpo de la issue describe es de §17 y se calcula
 * sobre `representation` y `high_rating_representation`, que son materia de
 * meta analytics y no existen todavía; medido el 20 de septiembre de 2026, el
 * tramo alto entero (≥ 2400) tenía 666 personajes repartidos en 40 specs —57 en
 * la más poblada—, así que ninguna spec llega al n≥100 que el propio §17 exige
 * para declarar una tendencia. Esa parte no se implementa aquí.
 *
 * Lo que este módulo decide es una sola cosa, y es la difícil: **cuándo un
 * movimiento se puede afirmar**.
 */
import { MIN_SAMPLE_HIGH } from "./confidence";

/** Una adopción medida en una corrida: el porcentaje y la base de la que sale. */
export interface AdoptionPoint {
  /** En tanto por uno, como se guarda. */
  value: number;
  /** Sobre cuántos se calculó **esta** cifra, no cuánta gente hay en el tramo. */
  denominator: number;
}

/** Un movimiento que se puede afirmar. */
export interface AdoptionChange {
  /** `now.value − before.value`, con signo. Positivo = se lleva más que antes. */
  delta: number;
  direction: "up" | "down";
  before: AdoptionPoint;
  now: AdoptionPoint;
}

/**
 * Cuántos errores típicos tiene que separarse el movimiento para enseñarlo.
 *
 * 2,58 es el 99% de una normal, y no el 1,96 del 95% que es la costumbre,
 * porque aquí no se hace **una** comparación: una corrida escribe del orden de
 * 8.000 pares de variable y escalón, y al 5% el azar solo ya devolvería unas
 * 400 "tendencias". Medido sobre las corridas del 13 y el 20 de septiembre de
 * 2026, al 99% quedan 142 movimientos en toda la base — de los cuales 124 son
 * de gear, que es lo que de verdad se mueve mientras la gente se equipa, y 0 de
 * árbol de héroe, que es lo que de verdad no se mueve. Un umbral que no
 * distinguiera esos dos casos no estaría midiendo nada.
 *
 * No es una constante afinada contra los datos: es el nivel de significación, y
 * lo que se afina contra los datos —el ruido de cada fila— lo pone el
 * denominador de la propia fila.
 */
export const MIN_TREND_Z = 2.58;

/**
 * El movimiento de una adopción entre dos corridas, o `null` si no se puede
 * afirmar.
 *
 * **Por qué no hay un umbral fijo de puntos porcentuales.** La tentación es un
 * `MIN_TREND_DELTA = 0.05` al estilo de `MIN_DISCRIMINATIVE_DELTA`, y con estos
 * datos no funciona: entre el 13 y el 20 de septiembre de 2026, la mediana de
 * |Δ| fue de 3,6 puntos en los items de gear y de 0,9 en los nodos de talento,
 * y el máximo de 31 y 26 respectivamente. Cualquier corte único o inunda una
 * familia o silencia la otra — 10 puntos dejaban 275 movimientos de gear y
 * ninguno de árbol de héroe. El ruido no es el mismo en todas las filas porque
 * no lo es su base ni su porcentaje, así que el umbral se deriva de la fila en
 * vez de escribirse, que es el mismo principio con el que la confianza se
 * deriva del denominador y no se guarda (ADR 0033).
 *
 * El contraste es el de dos proporciones, con el error típico calculado sobre
 * las dos bases. Trata las dos muestras como independientes, y no lo son del
 * todo —de una semana a otra volvemos a leer a mucha de la misma gente—, lo que
 * hace la prueba **conservadora**: si estuvieran emparejadas, la varianza sería
 * menor y pasaría más. Se prefiere así: dejar de contar un movimiento real es un
 * silencio, y contar uno que no existe es una cifra inventada.
 *
 * Tres razones para devolver `null`, y ninguna es "no ha cambiado":
 *
 * 1. **Alguna de las dos bases no llega a `MIN_SAMPLE_HIGH`.** Es el umbral que
 *    §17 fija para declarar una tendencia, más alto que el de enseñar una
 *    comparación: una cifra puede ser publicable y su variación no serlo.
 * 2. **El movimiento no se distingue del ruido de muestreo** de sus propias
 *    bases.
 * 3. **No hay con qué comparar.** Eso lo decide quien empareja, no esta
 *    función: una variable sin fila la semana pasada no es una adopción del 0%.
 *    La poda de `aggregate_snapshots` borra de las corridas viejas las filas con
 *    menos de cinco usuarios, así que una ausencia puede ser "no lo llevaba
 *    nadie" o "lo llevaban tres y esa fila ya no está". Son indistinguibles, y
 *    `null` significa "no disponible", nunca "cero" (regla 5).
 */
export function adoptionChange(before: AdoptionPoint, now: AdoptionPoint): AdoptionChange | null {
  if (before.denominator < MIN_SAMPLE_HIGH || now.denominator < MIN_SAMPLE_HIGH) return null;

  const delta = now.value - before.value;
  if (delta === 0) return null;

  const change: AdoptionChange = { delta, direction: delta > 0 ? "up" : "down", before, now };

  // Varianza cero con delta distinto de cero solo pasa si las dos proporciones
  // están pegadas a un extremo y son distintas —del 0% al 100%—, que es el
  // movimiento más extremo posible y no uno que haya que descartar por no poder
  // dividir entre cero.
  const error = standardError(before, now);
  if (error === 0) return change;

  return Math.abs(delta) / error >= MIN_TREND_Z ? change : null;
}

/** Error típico de la diferencia de dos proporciones, cada una con su base. */
function standardError(before: AdoptionPoint, now: AdoptionPoint): number {
  return Math.sqrt(varianceOf(before) + varianceOf(now));
}

function varianceOf(point: AdoptionPoint): number {
  return (point.value * (1 - point.value)) / point.denominator;
}
