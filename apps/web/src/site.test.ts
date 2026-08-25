import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isPublicSite, siteUrl } from "./site";

describe("siteUrl", () => {
  it("usa la configurada cuando la hay", () => {
    assert.equal(
      siteUrl({ NEXT_PUBLIC_SITE_URL: "https://onerung.io" }).origin,
      "https://onerung.io",
    );
  });

  it("cae a la URL del deploy antes que a nada inventado", () => {
    const env = { DEPLOY_PRIME_URL: "https://deploy-preview-3--onerung.netlify.app" };
    assert.equal(siteUrl(env).origin, "https://deploy-preview-3--onerung.netlify.app");
  });

  it("no deja que un preview se anuncie como producción", () => {
    const env = {
      NEXT_PUBLIC_SITE_URL: "https://deploy-preview-3--onerung.netlify.app",
      DEPLOY_PRIME_URL: "https://deploy-preview-3--onerung.netlify.app",
    };
    assert.notEqual(siteUrl(env).origin, "https://onerung.io");
  });

  it("funciona en local sin configurar nada", () => {
    assert.equal(siteUrl({}).origin, "http://localhost:3000");
  });
});

describe("isPublicSite", () => {
  it("solo el contexto de producción es público", () => {
    assert.equal(isPublicSite({ CONTEXT: "production" }), true);
  });

  it("previews, ramas y local no lo son", () => {
    assert.equal(isPublicSite({ CONTEXT: "deploy-preview" }), false);
    assert.equal(isPublicSite({ CONTEXT: "branch-deploy" }), false);
    assert.equal(isPublicSite({}), false);
  });

  it("un contexto desconocido no indexa", () => {
    assert.equal(isPublicSite({ CONTEXT: "algo-que-netlify-invente" }), false);
  });
});
