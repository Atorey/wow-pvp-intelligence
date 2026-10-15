import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BracketPopulation, RunPopulationRead } from "@wowpvp/data";

import { arenaBoardFor } from "./meta-view";

const COMPUTED_AT = new Date("2026-10-12T05:30:00Z");

function run(...brackets: BracketPopulation[]): RunPopulationRead {
  return { seasonId: 42, computedAt: COMPUTED_AT, brackets };
}

function threeVsThree(): BracketPopulation {
  return {
    bracket: "3v3",
    population: 160,
    segments: [
      { segmentMin: 2000, population: 120, withoutSpec: 900 },
      { segmentMin: 2200, population: 40, withoutSpec: 300 },
      // Un tramo sin nadie no es una fila: no describe a nadie.
      { segmentMin: 2800, population: 0, withoutSpec: 0 },
    ],
    leaderboardEntries: 5_002,
    withoutSpec: 1_200,
  };
}

describe("arenaBoardFor", () => {
  it("parte cada tramo en quien tiene spec y quien no, de arriba abajo", () => {
    const board = arenaBoardFor(run(threeVsThree()), "3v3");

    assert.deepEqual(
      board?.rows.map((row) => [row.segment.id, row.withSpec, row.withoutSpec]),
      [
        ["2200-2400", 40, 300],
        ["2000-2200", 120, 900],
      ],
    );
    assert.equal(board?.withSpec, 160);
    assert.equal(board?.withoutSpec, 1_200);
  });

  it("declara el tope: el leaderboard de arena es uno para todas las specs", () => {
    const board = arenaBoardFor(run(threeVsThree()), "3v3");
    assert.equal(board?.capped, true);
    assert.equal(board?.leaderboardEntries, 5_002);
  });

  it("sin corrida o sin nadie en el bracket no hay página", () => {
    assert.equal(arenaBoardFor(null, "3v3"), null);
    assert.equal(arenaBoardFor(run(threeVsThree()), "2v2"), null);
    const empty = {
      ...threeVsThree(),
      segments: [{ segmentMin: 2000, population: 0, withoutSpec: 0 }],
    };
    assert.equal(arenaBoardFor(run(empty), "3v3"), null);
  });

  it("un sin spec que la corrida no dice no se convierte en cero (regla 5)", () => {
    const old = {
      ...threeVsThree(),
      segments: [
        { segmentMin: 2000, population: 50, withoutSpec: null },
        { segmentMin: 2200, population: 10, withoutSpec: 4 },
      ],
    };
    const board = arenaBoardFor(run(old), "3v3");
    assert.deepEqual(
      board?.rows.map((row) => [row.withSpec, row.withoutSpec]),
      [
        [10, 4],
        [50, null],
      ],
    );
    assert.equal(board?.withoutSpec, null);
  });
});
