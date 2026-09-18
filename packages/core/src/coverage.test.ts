import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildCoverage,
  coverageConfidence,
  hasPopulatedTarget,
  isServiceable,
  rollUpCoverage,
  type SegmentCoverageInput,
} from "./coverage";
import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM } from "./confidence";

function segment(overrides: Partial<SegmentCoverageInput> = {}): SegmentCoverageInput {
  return {
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    segmentMin: 1600,
    sampleSize: 200,
    gearSample: 50,
    activityWindowDays: 7,
    ...overrides,
  };
}

test("el par empareja cada escalón con el inmediatamente superior", () => {
  const pairs = buildCoverage([
    segment({ segmentMin: 1600, sampleSize: 200, gearSample: 10 }),
    segment({ segmentMin: 1800, sampleSize: 120, gearSample: 40 }),
  ]);

  const fromBelow = pairs.find((pair) => pair.subject.id === "1600-1800");
  assert.equal(fromBelow?.target.id, "1800-2000");
  assert.equal(fromBelow?.subjects, 200);
  // Los denominadores del par son los del OBJETIVO, no los del sujeto.
  assert.equal(fromBelow?.targetSampleSize, 120);
  assert.equal(fromBelow?.targetGearSample, 40);
  assert.equal(fromBelow?.targetWindow, 7);
});

test("un objetivo sin fila es un cero, no una ausencia", () => {
  // Es el caso que `population_segments` no sabe escribir: no inserta filas de
  // escalones vacíos, así que "encima de estos no hay nadie" no se distinguiría
  // de "no lo miramos".
  const [pair] = buildCoverage([segment({ segmentMin: 2000, sampleSize: 400 })]);

  assert.equal(pair?.target.id, "2200-2400");
  assert.equal(pair?.targetSampleSize, 0);
  assert.equal(pair?.targetGearSample, 0);
  assert.equal(pair?.targetWindow, null);
  assert.equal(isServiceable(pair!), false);
  assert.equal(hasPopulatedTarget(pair!), false);
});

test("un objetivo poblado sin sujetos debajo no es cobertura de nadie", () => {
  // Decisión 5 del ADR 0010: el gear del escalón alto no le sirve a nadie si no
  // hay quien mire desde debajo, y contarlo sería una métrica tranquilizadora.
  const pairs = buildCoverage([segment({ segmentMin: 2400, sampleSize: 500, gearSample: 500 })]);

  assert.equal(pairs.length, 1);
  assert.equal(pairs[0]?.subject.id, "2400-2600");
  assert.ok(pairs.every((pair) => pair.subject.id !== "2200-2400"));
});

test("el tramo abierto de arriba no emite par", () => {
  assert.deepEqual(buildCoverage([segment({ segmentMin: 3000, sampleSize: 80 })]), []);
});

test("la puerta es el gear del objetivo, nunca su población", () => {
  const [pair] = buildCoverage([
    segment({ segmentMin: 1600, sampleSize: 200 }),
    segment({ segmentMin: 1800, sampleSize: MIN_SAMPLE_HIGH * 10, gearSample: 0 }),
  ]);

  // Población de sobra y base de comparación vacía: confundirlas pintaría un
  // Player Gap sobre cero perfiles con la etiqueta "alta confianza".
  assert.equal(coverageConfidence(pair!).population, "high");
  assert.equal(coverageConfidence(pair!).gear, "insufficient");
  assert.equal(hasPopulatedTarget(pair!), true);
  assert.equal(isServiceable(pair!), false);
});

test("el rollup cuenta specs y personas por separado", () => {
  const pairs = buildCoverage([
    // Dos specs con sujetos en 1600-1800; solo una tiene gear arriba.
    segment({ bracket: "shuffle-mage-frost", segmentMin: 1600, sampleSize: 200 }),
    segment({
      bracket: "shuffle-mage-frost",
      segmentMin: 1800,
      sampleSize: 150,
      gearSample: MIN_SAMPLE_MEDIUM,
    }),
    segment({ bracket: "shuffle-priest-holy", segmentMin: 1600, sampleSize: 500 }),
    segment({ bracket: "shuffle-priest-holy", segmentMin: 1800, sampleSize: 150, gearSample: 0 }),
  ]);

  const [rollup] = rollUpCoverage(pairs);
  assert.equal(rollup?.subject.id, "1600-1800");
  assert.equal(rollup?.pairs, 2);
  assert.equal(rollup?.populatedTargets, 2);
  assert.equal(rollup?.serviceablePairs, 1);
  assert.equal(rollup?.subjects, 700);
  assert.equal(rollup?.subjectsWithPopulatedTarget, 700);
  // 500 sujetos y una sola spec servible: la cuenta en specs diría "la mitad",
  // y la cuenta en personas dice que a 500 de 700 no se les puede enseñar nada.
  assert.equal(rollup?.subjectsServed, 200);
});

test("el rollup sabe qué escalones son del público objetivo", () => {
  const rollups = rollUpCoverage(
    buildCoverage([
      segment({ segmentMin: 400, sampleSize: 900 }),
      segment({ segmentMin: 600, sampleSize: 900 }),
      segment({ segmentMin: 1600, sampleSize: 200 }),
      segment({ segmentMin: 1800, sampleSize: 150 }),
    ]),
  );

  assert.equal(rollups.find((r) => r.subject.id === "400-600")?.servesIcp, false);
  assert.equal(rollups.find((r) => r.subject.id === "1600-1800")?.servesIcp, true);
});
