import type { Locale } from "./locales";

/**
 * Cómo se escriben las cifras y las fechas en cada lengua.
 *
 * Vive aquí y no en cada componente porque el separador de miles cambia con el
 * idioma —2.282 en español, 2,282 en inglés— y una página que mezcle los dos se
 * lee como dos páginas. `Intl` ya sabe hacerlo; lo que hace falta es que nadie
 * llame a `toLocaleString()` sin decir en qué lengua está la página, que es
 * como se cuela el idioma del servidor en el texto.
 */

/** Un recuento: personajes observados, perfiles cargados, partidas. */
export function formatCount(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(value);
}

/**
 * Una cifra del juego: rating, item level, tramo de segmento.
 *
 * **Sin separador de miles**, y no es un descuido de formato: quien juega
 * escribe "2600", el tramo de la URL es `2400-2600` y `formatSegment()` lo
 * escribe igual, así que un "2,600" en inglés al lado de un "2400-2600" se lee
 * como dos cifras de cosas distintas. Los recuentos —observados, perfiles,
 * partidas— sí llevan separador: son cantidades de gente, no marcadores.
 */
export function formatRating(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { useGrouping: false }).format(value);
}

/**
 * El percentil, siempre hacia abajo.
 *
 * `Math.round()` convertiría un 99,98 en "percentil 100", y no hay percentil
 * 100: quien está arriba del todo no está por debajo de sí mismo. Truncar es
 * además la definición del rango percentil —qué porcentaje queda por debajo—,
 * así que no es una precaución, es la operación.
 */
export function formatPercentile(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale).format(Math.floor(value));
}

/**
 * Un porcentaje de adopción, en tanto por uno a la entrada.
 *
 * Redondea, y por eso **nunca va solo**: al lado se escribe siempre la fracción
 * cruda (§13.5), que es la que manda. Un "100% (311/312)" no es una
 * contradicción, es un redondeo con su base a la vista; un "100%" a secas sí
 * sería una afirmación que el dato no sostiene.
 *
 * El signo lo pone `Intl` en el sitio de cada lengua: en español va separado del
 * número y en inglés no.
 */
export function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 0 }).format(
    value,
  );
}

/**
 * La fecha de una observación. Sin hora: lo que importa es de qué día es el
 * dato, y una hora en UTC invita a restarla mentalmente contra la del lector.
 */
export function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}
