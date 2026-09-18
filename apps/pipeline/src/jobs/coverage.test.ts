import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "./coverage";

test("sin argumentos se lee una semana de corridas", () => {
  assert.equal(parseOptions([]).runs, 7);
});

test("--runs acepta un entero positivo y rechaza el resto", () => {
  assert.equal(parseOptions(["--runs", "30"]).runs, 30);
  // Una serie de cero corridas no es una serie corta: es una llamada sin
  // resultado que parecería "no hay cobertura".
  assert.throws(() => parseOptions(["--runs", "0"]), /entero mayor que cero/);
  assert.throws(() => parseOptions(["--runs", "1.5"]), /entero mayor que cero/);
  assert.throws(() => parseOptions(["--runs"]), /entero mayor que cero/);
});

test("una opción desconocida no se ignora en silencio", () => {
  assert.throws(() => parseOptions(["--season", "42"]), /Opción desconocida/);
});
