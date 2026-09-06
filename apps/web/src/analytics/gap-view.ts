import {
  isBracketSlug,
  parseSegmentSlug,
  parseSpecSlug,
  segmentSlug,
  type BracketSlug,
} from "@wowpvp/core";

import { isLocale, type Locale } from "../i18n/locales";
import type { GapView } from "../server/player-profile";

/**
 * La medición de la North Star (§35 del plan, ADR 0028).
 *
 * Todo lo de este módulo es puro y no toca ni el DOM ni la base de datos: lo
 * comparten el componente que emite y el endpoint que escribe, que es lo que
 * garantiza que las dos puntas hablen de las mismas cuatro palabras.
 */

/**
 * Cómo acabó la caja, en las cuatro únicas formas en las que puede acabar.
 *
 * Son los estados de `GapView` con el nivel de confianza ya desdoblado, porque
 * la métrica distingue `high` de `medium` y la caja no: el numerador de la
 * North Star son los dos primeros y el denominador son los cuatro.
 */
export type GapOutcome = "high" | "medium" | "insufficient" | "top-segment";

export const GAP_OUTCOMES: readonly GapOutcome[] = [
  "high",
  "medium",
  "insufficient",
  "top-segment",
];

export function isGapOutcome(value: string): value is GapOutcome {
  return (GAP_OUTCOMES as readonly string[]).includes(value);
}

/** Lo que la caja mide de sí misma, sin nada de quien la mira. */
export interface GapViewEventData {
  readonly outcome: GapOutcome;
  /** Slug canónico de spec (ADR 0016), nunca la etiqueta que se pinta. */
  readonly spec: string;
  readonly bracket: BracketSlug;
  /** El escalón de arriba. `null` en `top-segment`, que es donde no lo hay. */
  readonly segment: string | null;
  readonly locale: Locale;
}

/** El evento tal como viaja: lo anterior más quién lo emite, una vez. */
export interface GapViewEvent extends GapViewEventData {
  readonly visitorId: string;
}

/**
 * El desenlace de una caja ya construida.
 *
 * No vuelve a mirar ningún umbral: `canShowComparison()` y `confidenceFor()` ya
 * decidieron en `packages/core` y `player-profile.ts` guardó el resultado en el
 * estado (regla 2 del proyecto). Aquí solo se lee.
 */
export function gapOutcome(gap: GapView): GapOutcome {
  if (gap.state === "top-segment") return "top-segment";
  if (gap.state === "insufficient") return "insufficient";
  return gap.confidence;
}

/**
 * Los datos del evento de una caja, listos para el componente que los emite.
 *
 * El segmento se escribe con `segmentSlug()` y no a mano: es la misma forma que
 * publica la URL (`3000-plus`, nunca `3000-Infinity`), y tenerlas iguales es lo
 * que permite cruzar la métrica con el tráfico de una página de segmento.
 */
export function gapViewEventData(gap: GapView, options: GapViewSubject): GapViewEventData {
  return {
    outcome: gapOutcome(gap),
    spec: options.spec,
    bracket: options.bracket,
    segment: gap.state === "top-segment" ? null : segmentSlug(gap.targetSegment),
    locale: options.locale,
  };
}

export interface GapViewSubject {
  readonly spec: string;
  readonly bracket: BracketSlug;
  readonly locale: Locale;
}

/** El formato de un UUID v4 tal como lo escribe `crypto.randomUUID()`. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Lo que llega por el endpoint, validado contra los catálogos que ya existen.
 *
 * Es un endpoint abierto que escribe en Postgres, así que lo que no se valide
 * aquí se acumula ahí: una spec inventada no es un dato con el que no contamos,
 * es una fila que ensucia el denominador de la métrica para siempre. Se
 * comprueba **todo** y lo que no encaje no se escribe.
 *
 * El límite por peticiones e IP sigue siendo de #71; esto solo acota la forma.
 */
export function parseGapViewEvent(value: unknown): GapViewEvent | null {
  if (typeof value !== "object" || value === null) return null;
  const body = value as Record<string, unknown>;

  const { visitorId, outcome, spec, bracket, segment, locale } = body;

  if (typeof visitorId !== "string" || !UUID.test(visitorId)) return null;
  if (typeof outcome !== "string" || !isGapOutcome(outcome)) return null;
  if (typeof spec !== "string" || parseSpecSlug(spec) === undefined) return null;
  if (typeof bracket !== "string" || !isBracketSlug(bracket)) return null;
  if (typeof locale !== "string" || !isLocale(locale)) return null;

  // `null` es un valor legítimo aquí y no un campo que falta: es el tramo
  // abierto, que no tiene escalón encima. Lo que no vale es un slug que la
  // escala no genere (ADR 0020, decisión 9).
  if (segment !== null) {
    if (typeof segment !== "string" || parseSegmentSlug(segment) === undefined) return null;
  }

  return { visitorId, outcome, spec, bracket, segment, locale };
}
