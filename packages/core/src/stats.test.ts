import assert from "node:assert/strict";
import { test } from "node:test";
import { median, percentile } from "./stats";

test("la mediana no depende del orden de entrada", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([2, 1, 4, 3]), 2.5);
});

test("sin muestra no hay estadístico, y eso no es un cero", () => {
  assert.equal(median([]), null);
  assert.equal(percentile([], 0.25), null);
});

test("el percentil interpola entre vecinos", () => {
  // Con 5 valores, p25 cae en la posición 1 exacta: el segundo valor.
  assert.equal(percentile([10, 20, 30, 40, 50], 0.25), 20);
  // Con 4, cae entre el primero y el segundo, a tres cuartos del camino.
  assert.equal(percentile([10, 20, 30, 40], 0.25), 17.5);
});

test("los extremos son el mínimo y el máximo observados", () => {
  assert.equal(percentile([10, 20, 30], 0), 10);
  assert.equal(percentile([10, 20, 30], 1), 30);
});
