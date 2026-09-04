import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_SAMPLE_MEDIUM } from "./confidence";
import { standingWithin } from "./standing";

test("el recuento crudo sale intacto, haya percentil o no", () => {
  assert.deepEqual(standingWithin({ observed: 6, below: 3 }), {
    observed: 6,
    below: 3,
    percentile: null,
  });
});

test("el percentil aparece justo en el umbral y no antes", () => {
  assert.equal(standingWithin({ observed: MIN_SAMPLE_MEDIUM - 1, below: 10 }).percentile, null);
  assert.equal(standingWithin({ observed: MIN_SAMPLE_MEDIUM, below: 15 }).percentile, 50);
});

test("los extremos son 0 y 100, no null", () => {
  // Nadie por debajo es un percentil medido, no un dato que falte: el jugador
  // más bajo de la población observada está en el 0.
  assert.equal(standingWithin({ observed: 100, below: 0 }).percentile, 0);
  assert.equal(standingWithin({ observed: 100, below: 100 }).percentile, 100);
});

test("sin población no se divide entre cero", () => {
  assert.equal(standingWithin({ observed: 0, below: 0 }).percentile, null);
});
