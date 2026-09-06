import { readSegmentSamples } from "@wowpvp/data";
import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { indexableSpecRoutes } from "../seo/indexable";
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

  const samples = await readSegmentSamples(getDb());

  return sitemapEntries({
    base: siteUrl(process.env),
    specRoutes: indexableSpecRoutes(samples),
  });
}
