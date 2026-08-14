import assert from "node:assert/strict";
import { test } from "node:test";
import { ALL_SPECS, parseShuffleBracket, requireSpec, shuffleBracketId } from "./specs";

test("el bracket de shuffle se construye y se resuelve sin ambigüedad", () => {
  const havoc = requireSpec("demon-hunter", "havoc");
  const bracket = shuffleBracketId(havoc);
  assert.equal(bracket, "shuffle-demon-hunter-havoc");
  // Este es el caso que rompe cualquier parseo por split("-").
  assert.deepEqual(parseShuffleBracket(bracket), havoc);
});

test("un bracket desconocido no se adivina, devuelve undefined", () => {
  assert.equal(parseShuffleBracket("shuffle-mage-arcane-frost"), undefined);
});

test("una spec inexistente falla al arrancar, no en silencio", () => {
  assert.throws(() => requireSpec("mage", "fireball"), /Spec desconocida/);
});

test("el catálogo no tiene brackets duplicados", () => {
  const brackets = ALL_SPECS.map(shuffleBracketId);
  assert.equal(new Set(brackets).size, brackets.length);
});
