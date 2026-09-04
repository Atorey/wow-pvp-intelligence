import assert from "node:assert/strict";
import { test } from "node:test";

import { formatCount, formatDate, formatPercentile, formatRating } from "./format";

test("el separador de miles es el de la lengua de la página", () => {
  assert.equal(formatCount(2282, "es"), "2282");
  assert.equal(formatCount(22820, "es"), "22.820");
  assert.equal(formatCount(22820, "en"), "22,820");
});

test("una cifra del juego no lleva separador de miles en ninguna lengua", () => {
  // "2,600+" en inglés al lado de un tramo escrito "2400-2600" se lee como dos
  // cifras de cosas distintas, y el tramo es el que manda: es el de la URL.
  assert.equal(formatRating(2600, "en"), "2600");
  assert.equal(formatRating(2600, "es"), "2600");
  assert.equal(formatCount(2600, "en"), "2,600");
});

test("el percentil se trunca y no se redondea", () => {
  // Redondear haría "percentil 100" de un 99,98, y no hay percentil 100: quien
  // está arriba del todo no está por debajo de sí mismo.
  assert.equal(formatPercentile(99.98, "en"), "99");
  assert.equal(formatPercentile(70.02, "es"), "70");
});

test("la fecha de una observación va sin hora", () => {
  const observed = new Date("2026-08-29T03:38:01Z");

  assert.doesNotMatch(formatDate(observed, "es"), /\d+:\d+/);
  assert.match(formatDate(observed, "en"), /2026/);
});
