import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { indexableSpecRoutes } from "../seo/indexable";
import { cachedSegmentSamples } from "../server/aggregate-cache";
import { getDb } from "../server/db";
import "../server/env";
import { sitemapEntries } from "../seo/sitemap";
import { siteUrl } from "../site";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Se renderiza en petición y no al construir, por dos razones que apuntan al
  // mismo sitio. La de fondo: el sitemap describe qué se puede indexar hoy, y
  // eso lo dice la corrida de agregados de esta madrugada, no la base de datos
  // que hubiera el día del deploy. La práctica: el build de CI no tiene
  // secretos a propósito, y un sitemap prerenderizado lo obligaría a abrir
  // Postgres para compilar.
  await connection();

  // Por la caché de proceso (ADR 0030): la lista de lo indexable cambia con la
  // corrida diaria, no con cada visita de un rastreador, y un sitemap es
  // precisamente la página que más veces se pide sin que haya cambiado nada.
  const samples = await cachedSegmentSamples(getDb());

  return sitemapEntries({
    base: siteUrl(process.env),
    specRoutes: indexableSpecRoutes(samples),
  });
}
