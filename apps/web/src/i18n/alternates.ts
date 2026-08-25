import { LOCALES, SOURCE_LOCALE, localizedPathname, type Locale } from "./locales";

export interface Alternates {
  /** Cada versión es canónica de sí misma (ADR 0012, decisión 4). */
  readonly canonical: string;
  readonly languages: Record<string, string>;
}

/**
 * Los `hreflang` de una página, recíprocos entre las dos lenguas y con
 * `x-default` apuntando al idioma fuente.
 *
 * Devuelve rutas relativas a propósito: el dominio lo pone `metadataBase`, así
 * que esto no depende de en qué entorno corra. La canonicalización completa
 * —parámetros, paginación, qué se indexa— es de #26.
 */
export function alternatesFor(pathname: string, locale: Locale): Alternates {
  const languages: Record<string, string> = {};
  for (const candidate of LOCALES) {
    languages[candidate] = localizedPathname(pathname, candidate);
  }
  languages["x-default"] = localizedPathname(pathname, SOURCE_LOCALE);

  return { canonical: localizedPathname(pathname, locale), languages };
}
