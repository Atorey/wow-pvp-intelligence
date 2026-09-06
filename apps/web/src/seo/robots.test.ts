import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { robotsRules } from "./robots";

describe("robotsRules", () => {
  it("en producción abre el sitio y cierra la API y la búsqueda", () => {
    const robots = robotsRules({
      CONTEXT: "production",
      NEXT_PUBLIC_SITE_URL: "https://onerung.io",
    });

    assert.deepEqual(robots.rules, {
      userAgent: "*",
      allow: "/",
      // El patrón cubre `/en/search` y `/es/search`: la búsqueda vive bajo el
      // prefijo de idioma.
      disallow: ["/api/", "/*/search"],
    });
    assert.equal(robots.sitemap, "https://onerung.io/sitemap.xml");
  });

  it("un preview se cierra entero y no anuncia su sitemap", () => {
    const robots = robotsRules({
      CONTEXT: "deploy-preview",
      DEPLOY_PRIME_URL: "https://deploy-preview-26--onerung.netlify.app",
    });

    assert.deepEqual(robots.rules, { userAgent: "*", disallow: "/" });
    assert.equal(robots.sitemap, undefined);
  });

  it("sin CONTEXT tampoco indexa: la lista blanca decide", () => {
    assert.deepEqual(robotsRules({}).rules, { userAgent: "*", disallow: "/" });
  });
});
