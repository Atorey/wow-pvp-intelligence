import assert from "node:assert/strict";
import { test } from "node:test";
import { leaderboardFileName } from "./fetch-leaderboard";
import { filesToPrune, summarizeCadence } from "./refresh-leaderboard";

const bracket = "shuffle-mage-frost";

function at(iso: string): Date {
  return new Date(iso);
}

test("summarizeCadence mide el intervalo entre publicaciones distintas", () => {
  const [summary] = summarizeCadence([
    { bracket, fetched_at: at("2026-08-16T00:00:00Z") },
    { bracket, fetched_at: at("2026-08-16T03:00:00Z") },
    { bracket, fetched_at: at("2026-08-16T09:00:00Z") },
  ]);

  assert.equal(summary?.changes, 3);
  assert.equal(summary?.medianHours, 4.5); // mediana de [3, 6]
  assert.equal(summary?.minHours, 3);
  assert.equal(summary?.maxHours, 6);
});

test("summarizeCadence no inventa una cadencia con una sola publicación", () => {
  const [summary] = summarizeCadence([{ bracket, fetched_at: at("2026-08-16T00:00:00Z") }]);

  assert.equal(summary?.changes, 1);
  assert.equal(summary?.medianHours, null);
});

test("summarizeCadence separa los brackets: cada spec publica por su cuenta", () => {
  const summaries = summarizeCadence([
    { bracket, fetched_at: at("2026-08-16T00:00:00Z") },
    { bracket: "shuffle-warrior-fury", fetched_at: at("2026-08-16T01:00:00Z") },
    { bracket, fetched_at: at("2026-08-16T03:00:00Z") },
    { bracket: "shuffle-warrior-fury", fetched_at: at("2026-08-16T09:00:00Z") },
  ]);

  assert.deepEqual(
    summaries.map((s) => [s.bracket, s.medianHours]),
    [
      ["shuffle-mage-frost", 3],
      ["shuffle-warrior-fury", 8],
    ],
  );
});

test("filesToPrune borra solo lo que supera la retención", () => {
  const now = at("2026-08-16T12:00:00Z");
  const viejo = leaderboardFileName(bracket, 40, "2026-08-12T09:00:00.000Z");
  const reciente = leaderboardFileName(bracket, 40, "2026-08-15T09:00:00.000Z");

  assert.deepEqual(filesToPrune([viejo, reciente], now, 3), [viejo]);
});

test("filesToPrune respeta el borde exacto de la ventana", () => {
  const now = at("2026-08-16T12:00:00Z");
  const justoEnElCorte = leaderboardFileName(bracket, 40, "2026-08-13T12:00:00.000Z");

  assert.deepEqual(filesToPrune([justoEnElCorte], now, 3), []);
});

test("filesToPrune deja en paz los archivos que no reconoce", () => {
  const now = at("2026-08-16T12:00:00Z");
  const ajenos = ["notas.json", "shuffle-mage-frost.json", "README.md"];

  assert.deepEqual(filesToPrune(ajenos, now, 0), []);
});
