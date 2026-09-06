import { SEARCH_PATH } from "@wowpvp/core";
import type { MetadataRoute } from "next";

import { type Environment, isPublicSite, siteUrl } from "../site";

/**
 * El `robots.txt`.
 *
 * Fuera de producción cierra el sitio entero: un preview con contenido real es
 * una copia del sitio en otro dominio, y la lista blanca de `isPublicSite` ya
 * decide eso mismo para el `noindex` de las páginas. Aquí se repite porque un
 * rastreador que solo lea el `robots.txt` no ve las etiquetas.
 *
 * `/api/` no sirve páginas y sus rutas ya responden con `X-Robots-Tag`. La
 * búsqueda se cierra por patrón —vive bajo el prefijo de idioma, así que son
 * `/en/search` y `/es/search`— por la misma razón que no entra en el sitemap.
 */
export function robotsRules(env: Environment): MetadataRoute.Robots {
  if (!isPublicSite(env)) {
    // Sin línea `Sitemap:`: anunciar el mapa de un sitio que se acaba de
    // prohibir entero es una invitación a rastrearlo igualmente.
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/api/", `/*${SEARCH_PATH}`] },
    sitemap: new URL("/sitemap.xml", siteUrl(env)).href,
  };
}
