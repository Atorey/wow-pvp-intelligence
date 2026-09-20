import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_SAMPLE_HIGH } from "./confidence";
import { adoptionChange, type AdoptionPoint } from "./trends";

function point(value: number, denominator = 150): AdoptionPoint {
  return { value, denominator };
}

test("un movimiento grande sobre bases suficientes se afirma, con su signo", () => {
  // El caso real que abrió la medición: 'Enveloping Legwraps of the Cosmic
  // Penitent' en Holy Priest 2000-2200, del 45,6% al 76,8% en una semana.
  const change = adoptionChange(point(0.456, 114), point(0.768, 112));

  assert.ok(change);
  assert.equal(change.direction, "up");
  assert.ok(Math.abs(change.delta - 0.312) < 1e-9);
  assert.equal(change.before.denominator, 114);
  assert.equal(change.now.denominator, 112);
});

test("el signo negativo es una bajada, no un valor absoluto", () => {
  const change = adoptionChange(point(0.855, 110), point(0.598, 112));

  assert.ok(change);
  assert.equal(change.direction, "down");
  assert.ok(change.delta < 0);
});

test("una base por debajo del umbral de tendencia no se afirma, aunque el salto sea enorme", () => {
  // 20 puntos porcentuales, que en la comparación entre escalones serían
  // discriminantes de sobra: lo que falta no es tamaño del movimiento sino
  // base sobre la que medirlo (§17).
  const justBelow = MIN_SAMPLE_HIGH - 1;
  assert.equal(adoptionChange(point(0.4, justBelow), point(0.6, 150)), null);
  assert.equal(adoptionChange(point(0.4, 150), point(0.6, justBelow)), null);
  assert.ok(adoptionChange(point(0.4, MIN_SAMPLE_HIGH), point(0.6, MIN_SAMPLE_HIGH)));
});

test("un movimiento pequeño no se afirma aunque las bases sean grandes", () => {
  // Dos puntos porcentuales sobre 150 es lo que la mediana de gear hace cada
  // semana sin que nadie cambie de equipo.
  assert.equal(adoptionChange(point(0.5), point(0.52)), null);
});

test("el umbral depende de la fila: el mismo delta pasa o no según el porcentaje", () => {
  // Ocho puntos. Cerca del 50% la varianza es máxima y no llega; cerca del
  // extremo es mucho menor y sí. Es justo lo que un umbral fijo en puntos
  // porcentuales no puede distinguir.
  assert.equal(adoptionChange(point(0.5, 300), point(0.58, 300)), null);
  assert.ok(adoptionChange(point(0.02, 300), point(0.1, 300)));
});

test("más base hace afirmable el mismo movimiento", () => {
  assert.equal(adoptionChange(point(0.5, 120), point(0.58, 120)), null);
  assert.ok(adoptionChange(point(0.5, 2000), point(0.58, 2000)));
});

test("sin movimiento no hay tendencia", () => {
  assert.equal(adoptionChange(point(0.5), point(0.5)), null);
});

test("del 0% al 100% se afirma: varianza cero no es una división que evitar", () => {
  const change = adoptionChange(point(0, 150), point(1, 150));

  assert.ok(change);
  assert.equal(change.direction, "up");
  assert.equal(change.delta, 1);
});
