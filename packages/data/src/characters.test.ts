import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { standingWithin } from "@wowpvp/core";
import {
  readActivity,
  readLatestObservedSeason,
  readLatestSnapshot,
  readPeakRating,
  readStanding,
} from "./characters";
import { fakeDb } from "./fake-db";

const OBSERVED_AT = new Date("2026-08-21T19:04:00Z");

function snapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    character_id: "0f1c…",
    name_display: "Anatorey",
    realm_slug: "sanguino",
    faction: "HORDE",
    season_id: 42,
    bracket: "shuffle-priest-holy",
    class_slug: "priest",
    spec_slug: "holy",
    rating: 1834,
    ladder_rank: null,
    matches_played: 212,
    matches_won: 110,
    matches_lost: 102,
    pvp_tier_id: 3,
    equipped_item_level: 639,
    average_item_level: 642,
    talent_loadout_code: null,
    captured_at: OBSERVED_AT,
    source: "leaderboard",
    ...overrides,
  };
}

describe("readLatestSnapshot", () => {
  it("declara la fuente de la observación junto al dato", async () => {
    const db = fakeDb([snapshotRow()]);
    const read = await readLatestSnapshot(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "anatorey",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.ok(read);
    // matches_played solo es comparable dentro de la misma fuente (ADR 0008),
    // así que el consumidor tiene que poder ver de cuál viene.
    assert.equal(read.provenance.source, "leaderboard");
    assert.equal(read.provenance.observedAt, OBSERVED_AT);
    assert.equal(read.matchesPlayed, 212);
  });

  it("ordena por captured_at, no por id", async () => {
    const db = fakeDb([snapshotRow()]);
    await readLatestSnapshot(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "anatorey",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    // Desde el ADR 0009 el histórico tiene huecos: su orden es el del reloj.
    assert.match(db.calls[0]?.text ?? "", /order by s\.captured_at desc/);
  });

  it("mantiene null en el código de talentos como 'no disponible'", async () => {
    const db = fakeDb([snapshotRow({ talent_loadout_code: null })]);
    const read = await readLatestSnapshot(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "anatorey",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.ok(read);
    assert.equal(read.talentLoadoutCode, null);
  });

  it("devuelve null si no se ha observado nunca en ese bracket", async () => {
    const db = fakeDb([]);
    const read = await readLatestSnapshot(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "nadie",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.equal(read, null);
  });
});

describe("readActivity", () => {
  it("devuelve la evidencia, no solo la fecha", async () => {
    const db = fakeDb([
      {
        last_active_at: OBSERVED_AT,
        evidence: "first-seen",
        last_played: 212,
        observations: 1,
        first_seen_at: OBSERVED_AT,
        last_seen_at: OBSERVED_AT,
        computed_at: OBSERVED_AT,
      },
    ]);

    const read = await readActivity(db, {
      characterId: "0f1c…",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.ok(read);
    // 'first-seen' no demuestra que haya jugado; el copy tiene que distinguirlo.
    assert.equal(read.evidence, "first-seen");
    assert.equal(read.observations, 1);
  });

  it("devuelve null cuando no hay fila, que no es lo mismo que estar inactivo", async () => {
    const db = fakeDb([]);
    const read = await readActivity(db, {
      characterId: "0f1c…",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.equal(read, null);
  });
});

describe("readStanding", () => {
  it("excluye los snapshots de búsqueda, igual que los agregados", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598, highest: 2709 }]);
    await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.match(db.calls[0]?.text ?? "", /s\.source <> 'search'/);
  });

  it("no aplica ventana de actividad: describe observados, no activos", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598, highest: 2709 }]);
    await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.ok(!/character_activity/.test(db.calls[0]?.text ?? ""));
  });

  it("cuenta una vez por personaje aunque tenga varios snapshots", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598, highest: 2709 }]);
    const read = await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.match(db.calls[0]?.text ?? "", /distinct on \(s\.character_id\)/);
    assert.equal(read.observed, 2282);
    assert.equal(read.below, 1598);
  });

  it("compone el percentil con la regla de core, no con una propia", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598, highest: 2709 }]);
    const read = await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.equal(read.percentile, standingWithin({ observed: 2282, below: 1598 }).percentile);
  });

  it("el máximo sale de la misma población que el recuento", async () => {
    // Si viniera de `population_segments` podría quedar por debajo del rating
    // del propio jugador, porque aquellos cuentan con ventana de actividad.
    const db = fakeDb([{ observed: 2282, below: 1598, highest: 2709 }]);
    const read = await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.equal(read.highest, 2709);
    assert.match(db.calls[0]?.text ?? "", /max\(rating\)/);
  });

  it("devuelve un recuento vacío en vez de fallar si el bracket no tiene población", async () => {
    const db = fakeDb([]);
    const read = await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-warrior-arms",
      rating: 1834,
    });

    assert.deepEqual(read, { observed: 0, below: 0, highest: null, percentile: null });
  });
});

describe("readLatestObservedSeason", () => {
  it("devuelve la última temporada en la que se observó al personaje", async () => {
    const db = fakeDb([{ season_id: 42 }]);
    const season = await readLatestObservedSeason(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "anatorey",
    });

    assert.equal(season, 42);
  });

  it("null es 'no consta en la población', no 'no existe'", async () => {
    // Un personaje por debajo del corte de 5.000 al que nadie ha buscado
    // todavía no tiene ni una fila, y eso no dice nada sobre si existe.
    const db = fakeDb([{ season_id: null }]);
    const season = await readLatestObservedSeason(db, {
      region: "eu",
      realmSlug: "sanguino",
      nameSlug: "nadie",
    });

    assert.equal(season, null);
  });
});

describe("readPeakRating", () => {
  it("mira el histórico entero y no la última fila", async () => {
    const db = fakeDb([{ peak: 2012 }]);
    const peak = await readPeakRating(db, {
      characterId: "0f1c…",
      bracket: "shuffle-priest-holy",
      seasonId: 42,
    });

    assert.equal(peak, 2012);
    assert.match(db.calls[0]?.text ?? "", /max\(rating\)/);
  });
});
