/**
 * El texto legal, aparte del diccionario de copy y a propósito.
 *
 * La mecánica es la misma que la de `i18n/copy` —dos diccionarios tipados, el
 * inglés define la forma, sin librería de i18n (ADR 0020, decisión 10)— y lo
 * que cambia es quién lo vigila.
 *
 * `copy.test.ts` comprueba que **ninguna frase recomienda nada**, que es la
 * regla 3 del proyecto: una cifra observada no puede presentarse como la causa
 * de un resultado. Esa regla habla del copy de datos, y un texto legal no lo es
 * — no cuelga de ninguna cifra—. Metido en el mismo diccionario obligaría a
 * eximir una sección entera, que es justo lo que el comentario de aquel test
 * prohíbe hacer: «no hay comodín, no se exime una sección completa». Separarlo
 * respeta las dos cosas en vez de agujerear una.
 *
 * La **etiqueta del enlace** del pie sí es copy de producto y se queda en
 * `copy.nav.privacy`, vigilada como todo lo demás.
 */
import type { Locale } from "../locales";
import { type Legal, en } from "./en";
import { es } from "./es";

export type { Legal };

const DOCUMENTS: Record<Locale, Legal> = { en, es };

export function legalFor(locale: Locale): Legal {
  return DOCUMENTS[locale];
}

/**
 * Cuándo se revisó por última vez, en un solo sitio y en ISO.
 *
 * La fecha no se escribe en cada lengua porque escrita dos veces diverge, y una
 * política de privacidad que se fecha distinto en cada idioma no dice cuándo se
 * revisó: cada idioma la formatea con `formatDate`.
 *
 * Es también la fecha en la que se leyeron las condiciones de las que depende
 * (ADR 0015, decisión 11): cuando se relean, se cambia aquí.
 */
export const LEGAL_UPDATED_AT = new Date("2026-09-07T00:00:00Z");
