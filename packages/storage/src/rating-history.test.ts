import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { addToRatingHistoryShard, emptyRatingHistoryShard, seriesKey } from "@wowpvp/core";
import { FAKE_STORAGE, fakeStorage } from "./fake-storage";
import { readRatingHistoryShard, writeRatingHistoryShard } from "./rating-history";

const MAGE = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

test("un shard que no existe todavía es null, no un error", async () => {
  const { fetchFn } = fakeStorage();
  assert.equal(await readRatingHistoryShard(FAKE_STORAGE, 42, "3f", fetchFn), null);
});

test("un shard vuelve de Storage igual que se subió, y se puede reescribir", async () => {
  const { fetchFn, objects } = fakeStorage();
  const shard = emptyRatingHistoryShard(42, "3f");
  addToRatingHistoryShard(shard, [
    {
      characterId: MAGE,
      bracket: "shuffle-mage-frost",
      seasonId: 42,
      at: new Date("2026-08-20T10:00:00Z"),
      rating: 1800,
    },
  ]);

  await writeRatingHistoryShard(FAKE_STORAGE, shard, fetchFn);
  // La segunda subida sobrescribe: el índice crece reescribiéndose.
  await writeRatingHistoryShard(FAKE_STORAGE, shard, fetchFn);

  assert.deepEqual([...objects.keys()], ["rating-history/s42/3f.json.gz"]);
  const read = await readRatingHistoryShard(FAKE_STORAGE, 42, "3f", fetchFn);
  assert.deepEqual(read?.series.get(seriesKey(MAGE, "shuffle-mage-frost")), [
    { at: new Date("2026-08-20T10:00:00Z"), rating: 1800 },
  ]);
});

test("un objeto que dice ser otro shard no se lee como este", async () => {
  const { fetchFn, objects } = fakeStorage();
  objects.set(
    "rating-history/s42/3f.json.gz",
    gzipSync(JSON.stringify({ v: 1, season: 42, shard: "a1", series: {} })),
  );

  await assert.rejects(readRatingHistoryShard(FAKE_STORAGE, 42, "3f", fetchFn), /dice ser/);
});
