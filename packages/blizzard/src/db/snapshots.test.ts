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
function fakeClient(
  queries: Recorded[],
  respond: (sql: string) => object[] | undefined = () => undefined,
): pg.PoolClient {
  return {
    query(sql: string, params: unknown[] = []) {
      queries.push({ sql, params });
      // El insert del snapshot devuelve id; el resto, lo que diga el test o nada.
      const rows =
        respond(sql) ?? (sql.includes("into character_snapshots") ? [{ id: "snap-1" }] : []);
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

function catalogInsert(queries: Recorded[]): Recorded[] {
  return queries.filter((q) => q.sql.includes("into gear_pieces"));
}

function gearInsert(queries: Recorded[]): Recorded[] {
  return queries.filter((q) => q.sql.includes("into character_snapshot_gear"));
}

test("el gear de un personaje son dos consultas: alta de piezas y fila del snapshot", async () => {
  const queries: Recorded[] = [];
  const gear = Array.from({ length: 16 }, (_, i) => gearRow(`SLOT_${i}`));

  await insertProfileSnapshot(fakeClient(queries), input(gear));

  const [pieces] = catalogInsert(queries);
  const [observation] = gearInsert(queries);
  assert.ok(pieces && observation);
  // Las 16 piezas en una sola tupla cada una, y la fila del snapshot con las
  // mismas 16 más su id delante.
  assert.equal(pieces.params.length, 16 * 10);
  assert.match(pieces.sql, /on conflict \(fingerprint\) do nothing/);
  assert.equal(observation.params.length, 16 * 10 + 1);
  assert.equal(observation.params[0], "snap-1");
  assert.match(observation.sql, /gear_piece_fingerprint\(v\.slot, v\.item_id/);
});

test("cada array de un item viaja como parámetro suyo, sin aplanarse con el siguiente", async () => {
  const queries: Recorded[] = [];
  const head = gearRow("HEAD", { itemId: 10, gemItemIds: [1, 2], bonusList: [7] });
  const neck = gearRow("NECK", { itemId: 20, gemItemIds: [3], bonusList: [8, 9] });

  await insertProfileSnapshot(fakeClient(queries), input([head, neck]));

  const [pieces] = catalogInsert(queries);
  assert.ok(pieces);
  // Los diez parámetros de cada item van seguidos: si los rangos se solaparan,
  // una pieza heredaría las gemas de la otra y sería otra pieza.
  assert.deepEqual(pieces.params.slice(0, 10), columnsOf(head));
  assert.deepEqual(pieces.params.slice(10, 20), columnsOf(neck));
  assert.match(pieces.sql, /values \(\$1::text, \$2::bigint, .*\$10::int\[\]\), \(\$11::text/);
});

test("un equipo al que le falta una pieza por resolver no se guarda", async () => {
  const queries: Recorded[] = [];
  const client = fakeClient(queries, (sql) =>
    sql.includes("into character_snapshot_gear") ? [{ refs: 1 }] : undefined,
  );

  await assert.rejects(
    insertProfileSnapshot(client, input([gearRow("HEAD"), gearRow("NECK")])),
    /2 entradas y 1 resueltas/,
  );
});

test("un personaje sin gear no manda ninguna consulta de gear", async () => {
  const queries: Recorded[] = [];

  await insertProfileSnapshot(fakeClient(queries), input([]));

  assert.equal(catalogInsert(queries).length + gearInsert(queries).length, 0);
});
