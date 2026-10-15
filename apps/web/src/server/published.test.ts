import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { isRouteBracketPublished, publishedBrackets } from "./published";

const VARIABLE = "BLIZZARD_ARENA_BRACKETS";
const before = process.env[VARIABLE];

afterEach(() => {
  if (before === undefined) delete process.env[VARIABLE];
  else process.env[VARIABLE] = before;
});

describe("publishedBrackets", () => {
  it("sin el interruptor, solo Solo Shuffle", () => {
    process.env[VARIABLE] = "";
    assert.deepEqual(publishedBrackets(), ["solo-shuffle"]);
  });

  it("la arena que enciende el interruptor, en el orden del catálogo", () => {
    process.env[VARIABLE] = "3v3,2v2";
    assert.deepEqual(publishedBrackets(), ["solo-shuffle", "2v2", "3v3"]);
  });

  it("una ruta de spec sin modalidad existe siempre; una de arena apagada, no", () => {
    process.env[VARIABLE] = "2v2";
    const spec = { classSlug: "mage", specSlug: "frost", label: "Frost Mage" };
    assert.equal(isRouteBracketPublished({ spec, bracket: undefined, segment: undefined }), true);
    assert.equal(isRouteBracketPublished({ spec, bracket: "2v2", segment: undefined }), true);
    assert.equal(isRouteBracketPublished({ spec, bracket: "3v3", segment: undefined }), false);
  });
});
