/**
 * Los dos idiomas del producto y cómo se elige uno cuando la URL no lo dice.
 *
 * El reparto del ADR 0012: el inglés es el idioma fuente y ninguna de las dos
 * lenguas vive sin prefijo. Aquí solo está la parte que se puede probar sin
 * navegador; la frase concreta que ve el jugador es de #25 y #65.
 */

export const LOCALES = ["en", "es"] as const;

export type Locale = (typeof LOCALES)[number];

/**
 * El idioma en el que se escribe primero y al que apunta `x-default`
 * (ADR 0012, decisiones 1 y 4). No es "el idioma por defecto del usuario":
 * es el que se sirve cuando no hay nada mejor que servir.
 */
export const SOURCE_LOCALE: Locale = "en";

export function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value);
}

/**
 * El locale que ya lleva la ruta, si lo lleva. `undefined` significa que la
 * URL no está prefijada y hay que redirigir: no existe la versión sin prefijo.
 */
export function localeFromPathname(pathname: string): Locale | undefined {
  const first = pathname.split("/")[1] ?? "";
  return isLocale(first) ? first : undefined;
}

export function localizedPathname(pathname: string, locale: Locale): string {
  const withoutLocale = localeFromPathname(pathname) ? pathname.slice(3) : pathname;
  // Sin esto, "/" acabaría en "/en/" y "/en" y "/en/" serían dos URL para la
  // misma página — dos canonicals que resolver en #26 por una barra.
  const rest = withoutLocale === "/" ? "" : withoutLocale;
  return `/${locale}${rest}`;
}

interface LanguageRange {
  readonly tag: string;
  readonly quality: number;
}

function parseAcceptLanguage(header: string): LanguageRange[] {
  const ranges: LanguageRange[] = [];

  for (const part of header.split(",")) {
    const [tag, ...parameters] = part.trim().split(";");
    if (!tag) continue;

    const q = parameters
      .map((parameter) => parameter.trim())
      .find((parameter) => parameter.startsWith("q="))
      ?.slice(2);

    // Un q ausente es 1 por RFC 9110; uno ilegible no es 1, es un encabezado
    // roto, y adivinarle una preferencia al visitante es peor que ignorarlo.
    const quality = q === undefined ? 1 : Number.parseFloat(q);
    if (!Number.isFinite(quality) || quality <= 0) continue;

    ranges.push({ tag: tag.toLowerCase(), quality });
  }

  return ranges;
}

/**
 * Traduce un `Accept-Language` a uno de los dos idiomas que servimos.
 *
 * Se compara solo la subetiqueta primaria: `es-419` y `es-ES` son español para
 * lo que este producto decide, que es qué prefijo lleva la URL. Distinguir
 * variantes crearía URL que el ADR 0012 no contempla.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return SOURCE_LOCALE;

  const ranges = parseAcceptLanguage(acceptLanguage);
  // Orden estable: a igual q gana el que el navegador puso antes, que es lo
  // que el propio encabezado quiere decir con el orden.
  const preferred = [...ranges].sort((a, b) => b.quality - a.quality);

  for (const range of preferred) {
    const primary = range.tag.split("-")[0] ?? "";
    if (isLocale(primary)) return primary;
    // "*" es "cualquiera me vale", así que vale el idioma fuente.
    if (range.tag === "*") return SOURCE_LOCALE;
  }

  return SOURCE_LOCALE;
}
