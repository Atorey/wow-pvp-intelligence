import assert from "node:assert/strict";
import { test } from "node:test";
import { comparisonTargetFor } from "./comparison-target";
import { MIN_SAMPLE_MEDIUM } from "./confidence";
import { segmentFor } from "./segments";
import type { RatingSegment } from "./types";

/** La base de cada tramo por su suelo; lo que no aparece no tiene fila. */
function samples(bySegmentMin: Record<number, number>): (segment: RatingSegment) => number {
  return (segment) => bySegmentMin[segment.min] ?? 0;
}

const BASE = MIN_SAMPLE_MEDIUM;

test("con base en el inmediato, el objetivo es el inmediato aunque haya más arriba", () => {
  const target = comparisonTargetFor(segmentFor(1450), samples({ 1600: BASE, 1800: 500 }));

  assert.deepEqual(target, { mode: "next", segment: segmentFor(1600) });
});

test("sin base en el inmediato y con ella en el de encima, salta un tramo y lo dice", () => {
  const target = comparisonTargetFor(segmentFor(1250), samples({ 1400: BASE - 1, 1600: BASE }));

  assert.deepEqual(target, {
    mode: "skipped",
    segment: segmentFor(1600),
    skipped: [segmentFor(1400)],
  });
});

test("salta los tramos que haga falta, y los devuelve todos", () => {
  // Es el caso de todo Solo Shuffle por debajo de 1200 el 15 de octubre de 2026:
  // el primer tramo con base estaba en 1600-1800.
  const target = comparisonTargetFor(segmentFor(850), samples({ 1600: 200, 2000: 300 }));

  assert.deepEqual(target, {
    mode: "skipped",
    segment: segmentFor(1600),
    skipped: [segmentFor(1000), segmentFor(1200), segmentFor(1400)],
  });
});

test("un tramo servible encima gana a la base propia: no es la parte alta", () => {
  const target = comparisonTargetFor(segmentFor(850), samples({ 800: 200, 1600: 200 }));

  assert.equal(target.mode, "skipped");
});

test("sin base en ningún tramo de encima, se compara con el propio", () => {
  const target = comparisonTargetFor(segmentFor(2450), samples({ 2400: BASE, 2600: 4 }));

  assert.deepEqual(target, { mode: "peers", segment: segmentFor(2400) });
});

test("en el tramo abierto de arriba se compara con el propio si tiene base", () => {
  const top = segmentFor(3100);

  assert.deepEqual(comparisonTargetFor(top, samples({ 3000: BASE })), {
    mode: "peers",
    segment: top,
  });
  // Y sin base no hay nada, sin escalón que nombrar: no es falta de muestra arriba.
  assert.deepEqual(comparisonTargetFor(top, samples({})), { mode: "none", next: undefined });
});

test("sin base en ningún sitio, la ausencia la explica el inmediato", () => {
  const target = comparisonTargetFor(segmentFor(1994), samples({}));

  assert.deepEqual(target, { mode: "none", next: segmentFor(2000) });
});

test("la base es la que se le pasa, no la población: un umbral menos es ninguno", () => {
  const target = comparisonTargetFor(segmentFor(1994), samples({ 2000: BASE - 1 }));

  assert.equal(target.mode, "none");
});
