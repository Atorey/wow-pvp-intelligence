import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { sitemapEntries } from "./sitemap";

const BASE = new URL("https://onerung.io");

function urls(entries: ReturnType<typeof sitemapEntries>): string[] {
  return entries.map((entry) => entry.url);
}

describe("sitemapEntries", () => {
  it("publica cada página en las dos lenguas", () => {
    const all = urls(sitemapEntries({ base: BASE }));

    assert.deepEqual(all, [
      "https://onerung.io/en",
      "https://onerung.io/es",
      "https://onerung.io/en/methodology",
      "https://onerung.io/es/methodology",
      "https://onerung.io/en/privacy",
      "https://onerung.io/es/privacy",
    ]);
  });

  it("cada entrada declara las dos lenguas y el x-default", () => {
    const [home] = sitemapEntries({ base: BASE });

    assert.deepEqual(home?.alternates?.languages, {
      en: "https://onerung.io/en",
      es: "https://onerung.io/es",
      "x-default": "https://onerung.io/en",
    });
  });

  it("la portada va sin fecha y las páginas de texto con la suya", () => {
    const entries = sitemapEntries({ base: BASE });

    assert.equal(entries[0]?.lastModified, undefined);
    assert.ok(entries.find((entry) => entry.url.endsWith("/en/methodology"))?.lastModified);
    assert.ok(entries.find((entry) => entry.url.endsWith("/es/privacy"))?.lastModified);
  });

  it("no hay forma de que entren la búsqueda ni un perfil", () => {
    const all = urls(
      sitemapEntries({
        base: BASE,
        specRoutes: [{ path: "/spec/frost-mage", lastModified: new Date() }],
      }),
    );

    assert.equal(
      all.some((url) => url.includes("/search") || url.includes("/player/")),
      false,
    );
    assert.ok(all.includes("https://onerung.io/es/spec/frost-mage"));
  });

  it("el origen sale del entorno, no del dominio de producción", () => {
    // Un preview que se anunciara como onerung.io erosionaría el dominio (§39).
    const preview = new URL("https://deploy-preview-26--onerung.netlify.app");
    assert.ok(urls(sitemapEntries({ base: preview }))[0]?.startsWith(preview.origin));
  });
});
