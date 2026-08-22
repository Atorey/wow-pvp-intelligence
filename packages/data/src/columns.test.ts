import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toNumber, toNumberOrNull } from "./columns";

describe("toNumber", () => {
  it("convierte los numeric y bigint que el driver devuelve como string", () => {
    assert.equal(toNumber("0.74000000"), 0.74);
    assert.equal(toNumber("228858"), 228858);
    assert.equal(toNumber(639), 639);
  });

  it("no convierte la cadena vacía en un cero creíble", () => {
    assert.throws(() => toNumber(""), /Se esperaba un número/);
    assert.throws(() => toNumber("   "), /Se esperaba un número/);
    assert.throws(() => toNumber("NaN"), /Se esperaba un número/);
  });
});

describe("toNumberOrNull", () => {
  it("deja pasar null, que sigue significando 'no disponible'", () => {
    assert.equal(toNumberOrNull(null), null);
    assert.equal(toNumberOrNull("1897.5"), 1897.5);
  });
});
