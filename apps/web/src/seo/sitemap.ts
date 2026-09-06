import { HOME_PATH, METHODOLOGY_PATH, PRIVACY_PATH } from "@wowpvp/core";
import type { MetadataRoute } from "next";

import { absoluteAlternates } from "../i18n/alternates";
import { LEGAL_UPDATED_AT } from "../i18n/legal";
import { LOCALES, localizedPathname } from "../i18n/locales";
import { METHODOLOGY_UPDATED_AT } from "../i18n/methodology";
import type { IndexableRoute } from "./indexable";

/**
 * Las páginas que existen sin depender de ningún dato.
 *
 * `/search` no está, y no por descuido: no es contenido, es la consulta de una
 * persona (ADR 0024, decisión 6). `/privacy` sí, porque es texto propio y
 * sustancial —el ADR 0028 la dejó fuera "hasta que #26 decida", y esto es la
 * decisión (ADR 0029, decisión 6)—. La portada va sin fecha: no tiene una que
 * no sea inventada.
 */
const STATIC_ROUTES: readonly IndexableRoute[] = [
  { path: METHODOLOGY_PATH, lastModified: METHODOLOGY_UPDATED_AT },
  { path: PRIVACY_PATH, lastModified: LEGAL_UPDATED_AT },
];

/**
 * El sitemap entero, a partir de las rutas que ya se sabe que son indexables.
 *
 * Recibe las rutas de spec en vez de leerlas: lo que decide qué se publica es
 * `indexableSpecRoutes`, y lo que hace esta función es traducir esa lista a las
 * dos lenguas. Los perfiles no entran nunca —son miles de rutas dinámicas contra
 * Postgres y se descubren por enlace (ADR 0029, decisión 4)—, así que no hay
 * parámetro por el que pudieran colarse.
 */
export function sitemapEntries({
  base,
  specRoutes = [],
}: {
  base: URL;
  specRoutes?: readonly IndexableRoute[];
}): MetadataRoute.Sitemap {
  const entries: MetadataRoute.Sitemap = [];

  const publish = (route: IndexableRoute | { path: string; lastModified?: Date }): void => {
    const languages = absoluteAlternates(route.path, base);
    for (const locale of LOCALES) {
      // Cada versión es canónica de sí misma (ADR 0012, decisión 4), así que las
      // dos entran como URL propias y cada una declara a la otra.
      entries.push({
        url: new URL(localizedPathname(route.path, locale), base).href,
        ...(route.lastModified ? { lastModified: route.lastModified } : {}),
        alternates: { languages },
      });
    }
  };

  publish({ path: HOME_PATH });
  for (const route of STATIC_ROUTES) publish(route);
  for (const route of specRoutes) publish(route);

  return entries;
}
