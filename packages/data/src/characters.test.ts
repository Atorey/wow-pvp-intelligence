import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_SAMPLE_MEDIUM } from "@wowpvp/core";
import { percentileFor, readActivity, readLatestSnapshot, readStanding } from "./characters";
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

describe("percentileFor", () => {
  it("no da percentil por debajo del umbral: la fracción sí, el porcentaje no", () => {
    assert.equal(percentileFor({ observed: 6, below: 3, percentile: null }), null);
    assert.equal(percentileFor({ observed: MIN_SAMPLE_MEDIUM - 1, below: 10, percentile: null }), null);
  });

  it("lo da a partir del umbral", () => {
    assert.equal(percentileFor({ observed: MIN_SAMPLE_MEDIUM, below: 15, percentile: null }), 50);
    assert.equal(percentileFor({ observed: 2282, below: 1598, percentile: null }), (1598 / 2282) * 100);
  });
});

describe("readStanding", () => {
  it("excluye los snapshots de búsqueda, igual que los agregados", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598 }]);
    await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.match(db.calls[0]?.text ?? "", /s\.source <> 'search'/);
  });

  it("no aplica ventana de actividad: describe observados, no activos", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598 }]);
    await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      rating: 1834,
    });

    assert.ok(!/character_activity/.test(db.calls[0]?.text ?? ""));
  });

  it("cuenta una vez por personaje aunque tenga varios snapshots", async () => {
    const db = fakeDb([{ observed: 2282, below: 1598 }]);
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

  it("devuelve un recuento vacío en vez de fallar si el bracket no tiene población", async () => {
    const db = fakeDb([]);
    const read = await readStanding(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-warrior-arms",
      rating: 1834,
    });

    assert.deepEqual(read, { observed: 0, below: 0, percentile: null });
  });
});
