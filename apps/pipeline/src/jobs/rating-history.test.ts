import assert from "node:assert/strict";
import { test } from "node:test";
import { seriesKey } from "@wowpvp/core";
import { readRatingHistoryShard } from "@wowpvp/storage";
import { FAKE_STORAGE, fakeStorage } from "@wowpvp/storage/fake-storage";
import { encodeRows } from "../storage";
import {
  backfill,
  indexRatingHistory,
  parseBackfillOptions,
  toObservation,
  type RatingRow,
} from "./rating-history";

const MAGE = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const PRIEST = "a1b2c3d4-0000-4000-8000-000000000000";

function row(characterId: string, iso: string, rating: number): RatingRow {
  return {
    character_id: characterId,
    bracket: "shuffle-mage-frost",
    season_id: 42,
    captured_at: iso,
    rating,
  };
}

async function ratings(fetchFn: typeof fetch, characterId: string, shard: string) {
  const read = await readRatingHistoryShard(FAKE_STORAGE, 42, shard, fetchFn);
  return read?.series.get(seriesKey(characterId, "shuffle-mage-frost"))?.map((p) => p.rating);
}

test("una fila de pg y una del archivo dan la misma observación", () => {
  const fromPg = toObservation({
    ...row(MAGE, "", 1800),
    captured_at: new Date("2026-08-20T10:00:00Z"),
  });
  const fromArchive = toObservation(row(MAGE, "2026-08-20T10:00:00.000Z", 1800));
  assert.deepEqual(fromPg, fromArchive);
});

test("indexar suma a lo que ya había y repetir un lote no cambia nada", async () => {
  const { fetchFn, objects } = fakeStorage();

  await indexRatingHistory(
    FAKE_STORAGE,
    [row(MAGE, "2026-08-20T10:00:00Z", 1800), row(PRIEST, "2026-08-20T10:00:00Z", 2100)].map(
      toObservation,
    ),
    fetchFn,
  );
  const second = [row(MAGE, "2026-08-22T10:00:00Z", 1850)].map(toObservation);
  await indexRatingHistory(FAKE_STORAGE, second, fetchFn);
  const report = await indexRatingHistory(FAKE_STORAGE, second, fetchFn);

  assert.equal(report.objects, 1);
  assert.equal(objects.size, 2);
  assert.deepEqual(await ratings(fetchFn, MAGE, "3f"), [1800, 1850]);
  assert.deepEqual(await ratings(fetchFn, PRIEST, "a1"), [2100]);
});

test("el backfill recorre los lotes de la bitácora y respeta lo ya indexado", async () => {
  const { fetchFn, objects } = fakeStorage();
  objects.set(
    "2026-09-19T05-40-12Z/0001/character_snapshots.ndjson.gz",
    encodeRows([
      row(MAGE, "2026-08-14T10:00:00.000Z", 1700),
      row(PRIEST, "2026-08-14T10:00:00.000Z", 2000),
    ]),
  );
  objects.set(
    "2026-09-19T05-40-12Z/0002/character_snapshots.ndjson.gz",
    encodeRows([row(MAGE, "2026-08-16T10:00:00.000Z", 1750)]),
  );
  // Lo que el archivado diario ya indexó antes del backfill no se pierde.
  await indexRatingHistory(
    FAKE_STORAGE,
    [toObservation(row(MAGE, "2026-09-20T10:00:00Z", 1900))],
    fetchFn,
  );

  const report = await backfill(
    FAKE_STORAGE,
    [
      { object_prefix: "2026-09-19T05-40-12Z/0001", snapshots: 2 },
      { object_prefix: "2026-09-19T05-40-12Z/0002", snapshots: 1 },
    ],
    { dryRun: false },
    fetchFn,
  );

  assert.equal(report.observations, 3);
  assert.equal(report.objects, 2);
  assert.deepEqual(await ratings(fetchFn, MAGE, "3f"), [1700, 1750, 1900]);
});

test("el backfill en seco no escribe el índice", async () => {
  const { fetchFn, objects } = fakeStorage();
  objects.set(
    "run/0001/character_snapshots.ndjson.gz",
    encodeRows([row(MAGE, "2026-08-14T10:00:00.000Z", 1700)]),
  );

  const report = await backfill(
    FAKE_STORAGE,
    [{ object_prefix: "run/0001", snapshots: 1 }],
    { dryRun: true },
    fetchFn,
  );

  assert.equal(report.objects, 1);
  assert.deepEqual([...objects.keys()], ["run/0001/character_snapshots.ndjson.gz"]);
});

test("un lote que falta o que no cuadra con la bitácora para el backfill", async () => {
  const { fetchFn, objects } = fakeStorage();
  await assert.rejects(
    backfill(
      FAKE_STORAGE,
      [{ object_prefix: "run/0001", snapshots: 1 }],
      { dryRun: true },
      fetchFn,
    ),
    /no en Storage/,
  );

  objects.set(
    "run/0002/character_snapshots.ndjson.gz",
    encodeRows([row(MAGE, "2026-08-14T10:00:00.000Z", 1700)]),
  );
  await assert.rejects(
    backfill(
      FAKE_STORAGE,
      [{ object_prefix: "run/0002", snapshots: 2 }],
      { dryRun: true },
      fetchFn,
    ),
    /la bitácora dice 2/,
  );
});

test("el backfill solo entiende --dry-run", () => {
  assert.deepEqual(parseBackfillOptions([]), { dryRun: false });
  assert.deepEqual(parseBackfillOptions(["--dry-run"]), { dryRun: true });
  assert.throws(() => parseBackfillOptions(["--season", "42"]), /Opción desconocida/);
});
