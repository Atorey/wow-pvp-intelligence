import assert from "node:assert/strict";
import { test } from "node:test";
import { LEADERBOARD_CAP, isLeaderboardCapped } from "./leaderboard";

test("una publicación que llena el tope está recortada", () => {
  assert.equal(isLeaderboardCapped(LEADERBOARD_CAP), true);
});

test("una a una entrada del tope no lo está: el tope es un hecho, no una cercanía", () => {
  assert.equal(isLeaderboardCapped(LEADERBOARD_CAP - 1), false);
});

test("sin saber cuántas entradas trajo no se afirma el recorte", () => {
  assert.equal(isLeaderboardCapped(null), false);
});
