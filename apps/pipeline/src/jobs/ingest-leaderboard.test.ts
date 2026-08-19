import assert from "node:assert/strict";
import { test } from "node:test";
import { dedupeEntries, type LeaderboardEntry } from "./ingest-leaderboard";

function entry(overrides: {
  id?: number;
  realm?: string;
  name?: string;
  rank: number;
  rating?: number;
}): LeaderboardEntry {
  return {
    character: {
      id: overrides.id ?? 1,
      name: overrides.name ?? "Alice",
      realm: { slug: overrides.realm ?? "ragnaros" },
    },
    rank: overrides.rank,
    rating: overrides.rating ?? 1800,
  };
}

test("dedupeEntries deja pasar una publicación sin repeticiones", () => {
  const entries = [
    entry({ id: 1, name: "Alice", rank: 1 }),
    entry({ id: 2, name: "Bob", rank: 2 }),
  ];

  assert.deepEqual(dedupeEntries(entries), entries);
});

test("dedupeEntries colapsa el mismo personaje bajo dos identidades", () => {
  // El caso que abortaba la ingesta entera: mismo character.id, dos (reino, nombre).
  const viva = entry({ id: 7, realm: "ragnaros", name: "Newname", rank: 12 });
  const residuo = entry({ id: 7, realm: "sanguino", name: "Oldname", rank: 340 });

  assert.deepEqual(dedupeEntries([residuo, viva]), [viva]);
});

test("dedupeEntries colapsa la misma identidad con dos ids", () => {
  const viva = entry({ id: 8, realm: "ragnaros", name: "Alice", rank: 5 });
  const otra = entry({ id: 9, realm: "ragnaros", name: "alice", rank: 90 });

  assert.deepEqual(dedupeEntries([otra, viva]), [viva]);
});

test("dedupeEntries no agrupa a los personajes sin id de Blizzard", () => {
  // null es "no disponible", no "es el mismo personaje" (regla 5).
  const sinId = [
    { ...entry({ rank: 1, name: "Alice" }), character: { name: "Alice", realm: { slug: "r" } } },
    { ...entry({ rank: 2, name: "Bob" }), character: { name: "Bob", realm: { slug: "r" } } },
  ] as unknown as LeaderboardEntry[];

  assert.equal(dedupeEntries(sinId).length, 2);
});

test("dedupeEntries no depende del orden en que llegan las entradas", () => {
  const a = entry({ id: 7, realm: "ragnaros", name: "Newname", rank: 12 });
  const b = entry({ id: 7, realm: "sanguino", name: "Oldname", rank: 340 });

  assert.deepEqual(dedupeEntries([a, b]), dedupeEntries([b, a]));
});
