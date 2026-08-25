import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { alternatesFor } from "./alternates";

describe("alternatesFor", () => {
  it("canonicaliza cada versión a sí misma, nunca a la otra", () => {
    assert.equal(alternatesFor("/spec/frost-mage", "es").canonical, "/es/spec/frost-mage");
    assert.equal(alternatesFor("/spec/frost-mage", "en").canonical, "/en/spec/frost-mage");
  });

  it("declara las dos lenguas desde cualquiera de las dos", () => {
    const fromSpanish = alternatesFor("/es/spec/frost-mage", "es");
    assert.deepEqual(fromSpanish.languages, {
      en: "/en/spec/frost-mage",
      es: "/es/spec/frost-mage",
      "x-default": "/en/spec/frost-mage",
    });
    assert.deepEqual(alternatesFor("/en/spec/frost-mage", "en").languages, fromSpanish.languages);
  });

  it("apunta x-default al idioma fuente", () => {
    const { languages } = alternatesFor("/", "es");
    assert.equal(languages["x-default"], languages["en"]);
  });
});
