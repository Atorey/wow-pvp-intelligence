import assert from "node:assert/strict";
import { test } from "node:test";
import { canShowComparison, confidenceFor, pickActivityWindow } from "./confidence";

test("el nivel de confianza sale del tamaño de muestra (§13.4)", () => {
  assert.equal(confidenceFor(100), "high");
  assert.equal(confidenceFor(99), "medium");
  assert.equal(confidenceFor(30), "medium");
  assert.equal(confidenceFor(29), "insufficient");
  assert.equal(confidenceFor(0), "insufficient");
});

test("por debajo de n=30 no se muestra comparación", () => {
  assert.equal(canShowComparison(30), true);
  assert.equal(canShowComparison(29), false);
});

test("se prefiere la ventana de 7 días si tiene muestra suficiente", () => {
  const choice = pickActivityWindow({ 7: 120, 14: 400 });
  assert.equal(choice.window, 7);
  assert.equal(choice.confidence, "high");
});

test("se cae a 14 días solo cuando 7 no llega al mínimo", () => {
  const choice = pickActivityWindow({ 7: 12, 14: 45 });
  assert.equal(choice.window, 14);
  assert.equal(choice.confidence, "medium");
});

test("si ninguna ventana llega, se declara insuficiente en vez de estirar a 30 días", () => {
  const choice = pickActivityWindow({ 7: 3, 14: 8 });
  assert.equal(choice.window, 14);
  assert.equal(choice.confidence, "insufficient");
});
