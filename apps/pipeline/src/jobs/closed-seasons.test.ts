import assert from "node:assert/strict";
import { test } from "node:test";
import { archiveRunStamp, pickClosedSeasons, seasonListSql } from "./closed-seasons";

const now = new Date("2026-09-26T06:00:00Z");
const daysAgo = (days: number): Date => new Date(now.getTime() - days * 86_400_000);

test("la temporada vigente nunca se cierra, aunque lleve días sin observaciones", () => {
  assert.deepEqual(pickClosedSeasons([{ seasonId: 42, lastCapturedAt: daysAgo(30) }], now), []);
});

test("una anterior se cierra tras dos semanas sin observaciones nuevas", () => {
  const seasons = [
    { seasonId: 42, lastCapturedAt: daysAgo(0) },
    { seasonId: 41, lastCapturedAt: daysAgo(40) },
    { seasonId: 40, lastCapturedAt: daysAgo(200) },
  ];
  assert.deepEqual(pickClosedSeasons(seasons, now), [40, 41]);
});

test("en el cambio de temporada la anterior sigue abierta mientras le llegue algo", () => {
  const seasons = [
    { seasonId: 42, lastCapturedAt: daysAgo(0) },
    { seasonId: 41, lastCapturedAt: daysAgo(3) },
  ];
  assert.deepEqual(pickClosedSeasons(seasons, now), []);
});

test("una temporada que solo queda en tablas derivadas se cierra: es una corrida cortada", () => {
  // Así se ven las filas de las tablas sin captured_at: una por tabla, a null.
  const seasons = [
    { seasonId: 42, lastCapturedAt: daysAgo(0) },
    { seasonId: 41, lastCapturedAt: null },
    { seasonId: 41, lastCapturedAt: null },
  ];
  assert.deepEqual(pickClosedSeasons(seasons, now), [41]);
});

test("sin ninguna observación no hay temporada vigente y no se cierra nada", () => {
  assert.deepEqual(pickClosedSeasons([{ seasonId: 41, lastCapturedAt: null }], now), []);
});

test("la lista de temporadas para el SQL solo admite enteros", () => {
  assert.equal(seasonListSql([40, 41]), "40, 41");
  assert.throws(() => seasonListSql([41.5]), /no entera/);
});

test("la carpeta de una corrida no lleva dos puntos", () => {
  assert.equal(archiveRunStamp(new Date("2026-09-26T05:41:07.123Z")), "2026-09-26T05-41-07Z");
});
