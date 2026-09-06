/**
 * El texto de la página de metodología, aparte del diccionario de copy.
 *
 * Se separa por **forma**, no por régimen: son párrafos y no etiquetas, y llegan
 * en arrays que el diccionario de copy no tiene en ninguna clave. La mecánica es
 * la de siempre —dos documentos tipados, el inglés define la forma, sin librería
 * de i18n (ADR 0020, decisión 10)—.
 *
 * Lo que **no** hereda del texto legal es la exención. `legal/index.ts` está
 * fuera del guardián causal de `copy.test.ts` porque una política de privacidad
 * no es copy de datos y no cuelga de ninguna cifra. Esto sí lo es: es la página
 * que explica las cifras, y es la que sostiene la regla 3 del proyecto. Así que
 * pasa por el mismo guardián, con la misma lista de patrones —la de
 * [`voice.ts`](../voice.ts), compartida por los tres documentos— y sin ninguna
 * clave exenta.
 */
import {
  DEFAULT_SEGMENT_SCALE,
  MIN_DISCRIMINATIVE_DELTA,
  MIN_SAMPLE_HIGH,
  MIN_SAMPLE_MEDIUM,
} from "@wowpvp/core";

import { formatCount, formatRating } from "../format";
import type { Locale } from "../locales";
import { type MethodologyDocument, type Thresholds, en } from "./en";
import { es } from "./es";

export type { MethodologyDocument, Section, Thresholds } from "./en";

const DOCUMENTS: Record<Locale, (thresholds: Thresholds) => MethodologyDocument> = { en, es };

/**
 * Los umbrales del dominio, escritos en la lengua de la página.
 *
 * Ninguno se teclea en un párrafo. El delta se guarda en tanto por uno porque
 * así se compara con una tasa de adopción, y aquí se lee en puntos
 * porcentuales, que es como se dice una diferencia entre dos porcentajes.
 */
export function methodologyThresholds(locale: Locale): Thresholds {
  return {
    high: formatCount(MIN_SAMPLE_HIGH, locale),
    medium: formatCount(MIN_SAMPLE_MEDIUM, locale),
    deltaPoints: formatCount(Math.round(MIN_DISCRIMINATIVE_DELTA * 100), locale),
    // Un tramo de rating es una cifra del juego, así que sin separador de miles.
    segmentSize: formatRating(DEFAULT_SEGMENT_SCALE.size, locale),
  };
}

export function methodologyFor(locale: Locale): MethodologyDocument {
  return DOCUMENTS[locale](methodologyThresholds(locale));
}

/**
 * Cuándo se revisó por última vez, en un solo sitio y en ISO, como la política
 * de privacidad: escrita dos veces, una fecha acaba siendo dos.
 *
 * Aquí fecha otra cosa que una política. Esta página describe cómo calcula el
 * sitio, así que la fecha dice hasta cuándo se ha comprobado que lo escrito y lo
 * que corre son lo mismo. Se mueve cuando cambia un umbral, una fuente o una
 * exclusión.
 */
export const METHODOLOGY_UPDATED_AT = new Date("2026-09-06T00:00:00Z");
