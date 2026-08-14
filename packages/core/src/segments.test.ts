import assert from "node:assert/strict";
import { test } from "node:test";
import { allSegments, formatSegment, nextSegment, segmentFor } from "./segments";

test("un rating cae en el tramo semiabierto [min, max)", () => {
  assert.equal(segmentFor(1840).id, "1800-2000");
  // El límite exacto sube: si no, un jugador contaría en dos segmentos.
  assert.equal(segmentFor(2000).id, "2000-2200");
  assert.equal(segmentFor(1999).id, "1800-2000");
});

test("el tramo superior es abierto y no tiene siguiente escalón", () => {
  const top = segmentFor(3500);
  assert.equal(top.min, 3000);
  assert.equal(top.max, Infinity);
  assert.equal(formatSegment(top), "3000+");
  // No hay segmento por encima contra el que comparar: el producto debe decirlo,
  // no fabricar una comparación (§13.5).
  assert.equal(nextSegment(top), undefined);
});

test("nextSegment es el escalón inmediatamente superior", () => {
  assert.equal(nextSegment(segmentFor(1840))?.id, "2000-2200");
});

test("los tramos cubren la escala sin huecos ni solapes", () => {
  const segments = allSegments();
  for (let i = 1; i < segments.length; i++) {
    assert.equal(segments[i]!.min, segments[i - 1]!.max);
  }
});

test("la escala es configurable (la distribución cambia cada temporada)", () => {
  const scale = { size: 100, floor: 1000, ceiling: 2000 };
  assert.equal(segmentFor(1450, scale).id, "1400-1500");
  assert.equal(segmentFor(500, scale).id, "1000-1100");
});
