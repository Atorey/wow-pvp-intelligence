import type { MetadataRoute } from "next";

import { robotsRules } from "../seo/robots";

/**
 * Vive fuera de `[locale]` porque no es una página: hay un solo `robots.txt` por
 * dominio. El `config.matcher` de `proxy.ts` ya lo excluye de la negociación de
 * idioma, así que llega sin prefijo y sin redirección.
 */
export default function robots(): MetadataRoute.Robots {
  return robotsRules(process.env);
}
