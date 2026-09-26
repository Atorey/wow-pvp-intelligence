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
 * Una proporción de población: qué parte de lo observado es de un tramo o de
 * una spec.
 *
 * Con un decimal, al contrario que la adopción, porque aquí los valores
 * pequeños son lo normal: cuarenta specs se reparten una modalidad y un tramo
 * alto pesa menos del 1 % de su spec. Sin decimal, media tabla diría "0 %" de
 * tramos que tienen gente. Tampoco va sola: al lado va el recuento del que sale.
 */
export function formatShare(value: number, locale: Locale): string {
  // El decimal es fijo, también cuando es un cero: estas cifras se leen en
  // columna, y un "5 %" al lado de un "6,8 %" parece medido con otra precisión.
  return new Intl.NumberFormat(locale, {
    style: "percent",
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
}

/**
 * Cuánto se ha movido una adopción, en puntos porcentuales y con signo.
 *
 * **Puntos y no porcentaje**, y la diferencia no es de estilo: del 45 % al 77 %
 * son 31 puntos y también "un 68 % más", y las dos cifras describen el mismo
 * hecho con tamaños distintos. La segunda infla los movimientos que parten de
 * poco —del 1 % al 2 % es "el doble"— y aquí lo que se compara entre filas es
 * cuánto se ha movido cada una sobre la misma escala.
 *
 * El signo lo pone `Intl` con el menos de cada lengua, que no es el guion del
 * teclado. El más también va siempre: una subida sin signo se leería como el
 * valor y no como la diferencia.
 */
export function formatPoints(delta: number, locale: Locale): string {
  const points = delta * 100;
  // Redondea a entero, salvo que el entero sea cero: un "+0 pts" diría que no
  // se ha movido justo en la fila que se marca porque sí se ha movido. Hoy no
  // puede pasar —con las bases que hay, lo mínimo que supera el ruido son diez
  // puntos largos— pero depende del denominador, y el denominador crece.
  const decimals = Math.abs(points) < 1 ? 1 : 0;
  return new Intl.NumberFormat(locale, {
    signDisplay: "always",
    maximumFractionDigits: decimals,
  }).format(points);
}

/**
 * Cuántas veces cabe una proporción en otra: "×1,3".
 *
 * Con el signo de multiplicar delante, y no con una "x" de teclado, porque es la
 * operación que describe —una proporción dividida por otra— y no una letra. Un
 * decimal fijo, incluido el del entero: una columna donde alternen "×2" y "×1,3"
 * se lee como dos precisiones distintas de la misma cifra.
 */
export function formatIndex(value: number, locale: Locale): string {
  const number = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value);
  return `×${number}`;
}

/**
 * La fecha de una observación. Sin hora: lo que importa es de qué día es el
 * dato, y una hora en UTC invita a restarla mentalmente contra la del lector.
 */
export function formatDate(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(value);
}

/**
 * Día y mes, sin año: la marca de un eje que abarca una temporada. El año lo
 * dice la temporada, y repetirlo en cada marca no cabe en el ancho de un móvil.
 */
export function formatDayMonth(value: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { day: "numeric", month: "short" }).format(value);
}
