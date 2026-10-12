import assert from "node:assert/strict";
import { test } from "node:test";
import { parseArenaBrackets } from "./config";

test("sin la variable, o vacía, no se ingiere arena", () => {
  assert.deepEqual(parseArenaBrackets(undefined), []);
  assert.deepEqual(parseArenaBrackets(""), []);
  assert.deepEqual(parseArenaBrackets(" , "), []);
});

test("los brackets salen en el orden del catálogo, sin repetir", () => {
  assert.deepEqual(parseArenaBrackets("3v3, 2V2,3v3"), ["2v2", "3v3"]);
  assert.deepEqual(parseArenaBrackets("3v3"), ["3v3"]);
});

test("un valor que no es arena falla en vez de ignorarse", () => {
  assert.throws(() => parseArenaBrackets("2v2,rbg"), /rbg no es un bracket de arena/);
  assert.throws(() => parseArenaBrackets("shuffle-mage-frost"), /no es un bracket de arena/);
});
