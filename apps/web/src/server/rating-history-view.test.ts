import assert from "node:assert/strict";
import { test } from "node:test";
import { ratingHistoryFor } from "./rating-history-view";

const day = (n: number): Date => new Date(Date.UTC(2026, 7, n, 12));

test("sin nada archivado la serie es lo caliente y está entera", () => {
  const view = ratingHistoryFor({
    hot: [
      { at: day(20), rating: 1850 },
      { at: day(18), rating: 1800 },
    ],
    archived: null,
    archivedObservations: 0,
  });

  assert.deepEqual(
    view.points.map((point) => point.rating),
    [1800, 1850],
  );
  assert.equal(view.gap, null);
});

test("con lo archivado leído entero, la serie une las dos mitades y no declara hueco", () => {
  const view = ratingHistoryFor({
    // El pico del día 3 sigue caliente y también está en el índice.
    hot: [
      { at: day(3), rating: 1900 },
      { at: day(20), rating: 1850 },
    ],
    archived: [
      { at: day(1), rating: 1800 },
      { at: day(3), rating: 1900 },
    ],
    // El pico no se archivó: solo cuenta la del día 1.
    archivedObservations: 1,
  });

  assert.deepEqual(
    view.points.map((point) => point.rating),
    [1800, 1900, 1850],
  );
  assert.equal(view.gap, null);
});

test("un punto caliente no tapa uno archivado que falte en el índice", () => {
  const view = ratingHistoryFor({
    hot: [
      { at: day(3), rating: 1900 },
      { at: day(20), rating: 1850 },
    ],
    // El índice solo trae el pico, que es caliente: de lo archivado no trae nada.
    archived: [{ at: day(3), rating: 1900 }],
    archivedObservations: 2,
  });

  assert.deepEqual(view.gap, { cause: "unindexed", missing: 2 });
});

test("si el índice no se puede leer, se dice cuánto falta en vez de pintar media temporada", () => {
  const view = ratingHistoryFor({
    hot: [{ at: day(20), rating: 1850 }],
    archived: null,
    archivedObservations: 7,
  });

  assert.deepEqual(view.gap, { cause: "unreadable", missing: 7 });
  assert.equal(view.points.length, 1);
});
