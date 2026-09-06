import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allSegments,
  formatSegment,
  nextSegment,
  previousSegment,
  segmentFor,
  servesIcpSubjects,
} from "./segments";

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

test("previousSegment es el escalón inmediatamente inferior", () => {
  assert.equal(previousSegment(segmentFor(1840))?.id, "1600-1800");
  // Desde el tramo abierto se baja al último cerrado, que sí existe.
  assert.equal(previousSegment(segmentFor(3500))?.id, "2800-3000");
});

test("el tramo de abajo no tiene escalón anterior", () => {
  assert.equal(previousSegment(segmentFor(0)), undefined);
});

test("previousSegment respeta el suelo de la escala, no el cero", () => {
  const scale = { size: 100, floor: 1000, ceiling: 2000 };
  assert.equal(previousSegment(segmentFor(1050, scale), scale), undefined);
  assert.equal(previousSegment(segmentFor(1150, scale), scale)?.id, "1000-1100");
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

test("un segmento objetivo sirve al ICP por quién tiene debajo, no por su propio rating", () => {
  // La comparación es contra el segmento superior, así que lo que decide es la
  // población de sujetos: 1600-1800 sirve a los de 1400-1600, que son ICP.
  assert.equal(servesIcpSubjects(segmentFor(1700)), true);
  assert.equal(servesIcpSubjects(segmentFor(2100)), true);
  // El borde de arriba: 2200-2400 sirve a los de 2000-2200, el último tramo del
  // ICP; 2400-2600 ya solo sirve a gente por encima de él.
  assert.equal(servesIcpSubjects(segmentFor(2300)), true);
  assert.equal(servesIcpSubjects(segmentFor(2500)), false);
  // Y el de abajo: 1400-1600 sirve a los de 1200-1400, que quedan fuera.
  assert.equal(servesIcpSubjects(segmentFor(1500)), false);
});

test("el fondo de la ladder no es ICP por mucha gente que se acumule ahí", () => {
  // Al empezar una temporada todo el mundo pasa por 200-600, así que ordenar
  // solo por población mandaría ahí el presupuesto de muestreo.
  assert.equal(servesIcpSubjects(segmentFor(300)), false);
  assert.equal(servesIcpSubjects(segmentFor(500)), false);
  // El primer tramo no tiene a nadie debajo: no sirve a ningún sujeto.
  assert.equal(servesIcpSubjects(segmentFor(0)), false);
});
