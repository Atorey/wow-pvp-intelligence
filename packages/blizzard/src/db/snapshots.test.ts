import assert from "node:assert/strict";
import { test } from "node:test";
import type pg from "pg";
import type { GearRow } from "../profile-mapping";
import { insertProfileSnapshot, type ProfileSnapshotInput } from "./snapshots";

interface Recorded {
  sql: string;
  params: unknown[];
}

/**
 * Cliente de mentira que solo apunta lo que se le pide: lo que se prueba aquí es
 * cuántas consultas salen y con qué parámetros, no lo que Postgres responde.
 */
function fakeClient(queries: Recorded[]): pg.PoolClient {
  return {
    query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      // Solo el insert del snapshot devuelve id; el resto no se lee.
      const rows = sql.includes("into character_snapshots") ? [{ id: "snap-1" }] : [];
      return Promise.resolve({ rows, rowCount: rows.length });
    },
  } as unknown as pg.PoolClient;
}

function gearRow(slot: string, overrides: Partial<GearRow> = {}): GearRow {
  return {
    slot,
    itemId: 1,
    itemName: "Item",
    itemLevel: 639,
    quality: "EPIC",
    enchantmentIds: [],
    enchantmentNames: [],
    gemItemIds: [],
    gemItemNames: [],
    bonusList: [],
    ...overrides,
  };
}

/** Las diez columnas de un item, en el orden en que las escribe el INSERT. */
function columnsOf(item: GearRow): unknown[] {
  return [
    item.slot,
    item.itemId,
    item.itemName,
    item.itemLevel,
    item.quality,
    item.enchantmentIds,
    item.enchantmentNames,
    item.gemItemIds,
    item.gemItemNames,
    item.bonusList,
  ];
}

function input(gear: readonly GearRow[]): ProfileSnapshotInput {
  return {
    characterId: "char-1",
    capturedAt: "2026-09-18T00:00:00.000Z",
    source: "profile",
    seasonId: 42,
    bracket: "shuffle-mage-frost",
    spec: { classSlug: "mage", specSlug: "frost", label: "Frost Mage" },
    rating: 1800,
    matchesPlayed: 100,
    matchesWon: 55,
    matchesLost: 45,
    pvpTierId: null,
    averageItemLevel: 639,
    equippedItemLevel: 639,
    talentCode: null,
    talents: [],
    heroTree: null,
    gear,
  };
}

function gearQuery(queries: Recorded[]): Recorded[] {
  return queries.filter((q) => q.sql.includes("into character_snapshot_gear"));
}

test("el gear de un personaje se escribe en una sola consulta", async () => {
  const queries: Recorded[] = [];
  const gear = Array.from({ length: 16 }, (_, i) => gearRow(`SLOT_${i}`));

  await insertProfileSnapshot(fakeClient(queries), input(gear));

  const inserts = gearQuery(queries);
  assert.equal(inserts.length, 1);
  // 16 tuplas de 10 parámetros más el snapshot_id, compartido por todas.
  assert.equal(inserts[0]?.params.length, 16 * 10 + 1);
  assert.match(inserts[0]?.sql ?? "", /on conflict \(snapshot_id, slot\) do nothing/);
});

test("cada array de un item viaja como parámetro suyo, sin aplanarse con el siguiente", async () => {
  const queries: Recorded[] = [];
  const head = gearRow("HEAD", { itemId: 10, gemItemIds: [1, 2], bonusList: [7] });
  const neck = gearRow("NECK", { itemId: 20, gemItemIds: [3], bonusList: [8, 9] });

  await insertProfileSnapshot(fakeClient(queries), input([head, neck]));

  const insert = gearQuery(queries)[0];
  assert.ok(insert);
  // Los diez parámetros de cada item van seguidos tras el snapshot_id: si los
  // rangos se solaparan, un item heredaría las gemas del otro.
  assert.equal(insert.params[0], "snap-1");
  assert.deepEqual(insert.params.slice(1, 11), columnsOf(head));
  assert.deepEqual(insert.params.slice(11, 21), columnsOf(neck));
  assert.match(
    insert.sql,
    /values \(\$1, \$2, \$3, \$4, \$5, \$6, \$7, \$8, \$9, \$10, \$11\), \(\$1, \$12, \$13, \$14, \$15, \$16, \$17, \$18, \$19, \$20, \$21\)/,
  );
});

test("un personaje sin gear no manda ninguna consulta de gear", async () => {
  const queries: Recorded[] = [];

  await insertProfileSnapshot(fakeClient(queries), input([]));

  assert.equal(gearQuery(queries).length, 0);
});
