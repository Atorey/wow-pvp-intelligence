import assert from "node:assert/strict";
import { test } from "node:test";
import { hashLeaderboard, hashPopulation } from "./fetch-leaderboard";

interface EntryOverrides {
  /** null = la entrada llega sin `character.id`, que es un caso real. */
  id?: number | null;
  name?: string;
  realm?: string;
  rank?: number;
  rating?: number;
  played?: number;
  tier?: number;
}

function entry(overrides: EntryOverrides = {}): Record<string, unknown> {
  const { id = 1, name = "Alice", realm = "ragnaros", rank = 1, rating = 2100 } = overrides;
  const { played = 40, tier = 3 } = overrides;
  return {
    character: { name, ...(id === null ? {} : { id }), realm: { slug: realm } },
    rank,
    rating,
    season_match_statistics: { played, won: played / 2, lost: played / 2 },
    tier: { id: tier },
  };
}

function payload(entries: Record<string, unknown>[], envelope: Record<string, unknown> = {}) {
  return { _links: { self: { href: "https://example" } }, ...envelope, entries };
}

// --- Huella de población (#53) ---

test("mover el rank no mueve la huella de población: el rank es derivado", () => {
  const antes = payload([entry({ id: 1, rank: 1 }), entry({ id: 2, name: "Bob", rank: 2 })]);
  const despues = payload([entry({ id: 1, rank: 2 }), entry({ id: 2, name: "Bob", rank: 1 })]);

  assert.equal(hashPopulation(antes), hashPopulation(despues));
  // Y esta es justo la diferencia con la huella del payload, que sí se mueve:
  // es lo que hacía que se reingiriera sin que cambiara nadie (#53).
  assert.notEqual(hashLeaderboard(antes), hashLeaderboard(despues));
});

test("el orden en que llegan las entradas no mueve la huella", () => {
  const a = payload([entry({ id: 1 }), entry({ id: 2, name: "Bob" })]);
  const b = payload([entry({ id: 2, name: "Bob" }), entry({ id: 1 })]);

  assert.equal(hashPopulation(a), hashPopulation(b));
});

test("lo que no ingerimos no mueve la huella: envoltorio y campos ajenos", () => {
  const a = payload([entry()], { season: { id: 42 } });
  const b = payload([{ ...entry(), faction: { type: "HORDE" } }], { season: { id: 43 } });

  assert.equal(hashPopulation(a), hashPopulation(b));
});

test("cambiar rating, partidas o tier sí mueve la huella: eso es población", () => {
  const base = payload([entry()]);

  assert.notEqual(hashPopulation(base), hashPopulation(payload([entry({ rating: 2101 })])));
  assert.notEqual(hashPopulation(base), hashPopulation(payload([entry({ played: 41 })])));
  assert.notEqual(hashPopulation(base), hashPopulation(payload([entry({ tier: 4 })])));
});

test("una alta o una baja mueven la huella: son población de verdad", () => {
  const dos = payload([entry({ id: 1 }), entry({ id: 2, name: "Bob" })]);
  const uno = payload([entry({ id: 1 })]);
  const otro = payload([entry({ id: 1 }), entry({ id: 3, name: "Cara" })]);

  assert.notEqual(hashPopulation(dos), hashPopulation(uno));
  assert.notEqual(hashPopulation(dos), hashPopulation(otro));
});

test("dos personajes sin id de Blizzard no se confunden entre sí", () => {
  const a = payload([entry({ id: null, name: "Alice", realm: "ragnaros" })]);
  const b = payload([entry({ id: null, name: "Alice", realm: "sanguino" })]);

  assert.notEqual(hashPopulation(a), hashPopulation(b));
});

test("las entradas que la ingesta descarta tampoco cuentan en la huella", () => {
  const limpio = payload([entry()]);
  const conBasura = payload([entry(), { character: { id: 99 }, rank: 2, rating: 1500 }]);

  assert.equal(hashPopulation(limpio), hashPopulation(conBasura));
});

test("un payload sin entradas no revienta y tiene huella propia", () => {
  assert.equal(hashPopulation(payload([])), hashPopulation({ entries: [] }));
  assert.equal(hashPopulation(undefined), hashPopulation(payload([])));
  assert.notEqual(hashPopulation(payload([])), hashPopulation(payload([entry()])));
});
