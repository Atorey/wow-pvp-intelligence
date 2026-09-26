import assert from "node:assert/strict";
import { test } from "node:test";
import { MAX_MARKED_POINTS, markedPoints, ratingChartGeometry } from "./rating-chart";

const day = (n: number): Date => new Date(Date.UTC(2026, 7, n, 12));

test("con una sola observación no hay gráfico que calcular", () => {
  assert.throws(() => ratingChartGeometry([{ at: day(1), rating: 1800 }]), /dos observaciones/);
});

test("el eje vertical va en pasos redondos que abarcan la serie entera", () => {
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1712 },
    { at: day(5), rating: 1896 },
  ]);

  assert.deepEqual(
    geometry.yTicks.map((tick) => tick.value),
    [1700, 1750, 1800, 1850, 1900],
  );
  // Arriba el más alto: `y` se cuenta desde arriba, como en la pantalla.
  assert.equal(geometry.yTicks[0]?.y, 100);
  assert.equal(geometry.yTicks[4]?.y, 0);
});

test("una temporada larga no se come el eje: como mucho cuatro intervalos", () => {
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1400 },
    { at: day(30), rating: 2450 },
  ]);

  assert.ok(geometry.yTicks.length - 1 <= 4);
  assert.equal(geometry.yTicks[0]?.value, 1000);
  assert.equal(geometry.yTicks.at(-1)?.value, 2500);
});

test("una serie plana cae en medio, no pegada a un borde", () => {
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1800 },
    { at: day(3), rating: 1800 },
  ]);

  assert.equal(geometry.points[0]?.y, 50);
});

test("el eje horizontal es tiempo, no orden de llegada", () => {
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1800 },
    { at: day(2), rating: 1820 },
    { at: day(11), rating: 1790 },
  ]);

  // El segundo punto está a un día de diez, no a mitad de camino.
  assert.equal(geometry.points[0]?.x, 0);
  assert.ok(Math.abs((geometry.points[1]?.x ?? 0) - 10) < 1e-9);
  assert.equal(geometry.points[2]?.x, 100);
  assert.equal(geometry.xTicks.length, 3);
  assert.deepEqual(geometry.xTicks[0]?.at, day(1));
  assert.deepEqual(geometry.xTicks.at(-1)?.at, day(11));
});

test("dos observaciones del mismo instante no dividen por cero", () => {
  // `mergeRatingPoints` lo impide, pero la geometría no depende de ello.
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1800 },
    { at: day(1), rating: 1810 },
  ]);
  assert.equal(geometry.points[0]?.x, 50);
  assert.equal(geometry.xTicks.length, 2);
});

test("el máximo marcado es la última vez que tocó su techo", () => {
  const geometry = ratingChartGeometry([
    { at: day(1), rating: 1900 },
    { at: day(2), rating: 1850 },
    { at: day(3), rating: 1900 },
    { at: day(4), rating: 1880 },
  ]);
  assert.equal(geometry.peakIndex, 2);
});

test("con muchas observaciones solo se marcan principio, final y máximo", () => {
  const few = ratingChartGeometry(
    Array.from({ length: 5 }, (_, i) => ({ at: day(i + 1), rating: 1800 + i })),
  );
  assert.equal(markedPoints(few).length, 5);

  const many = ratingChartGeometry(
    Array.from({ length: MAX_MARKED_POINTS + 1 }, (_, i) => ({
      at: new Date(day(1).getTime() + i * 3_600_000),
      rating: i === 10 ? 2100 : 1800,
    })),
  );
  assert.deepEqual(
    markedPoints(many).map((point) => point.rating),
    [1800, 2100, 1800],
  );
});
