import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parsePurgeOptions,
  purgedPath,
  ratingIndexObject,
  seasonCharacterFile,
  withoutCharacters,
} from "./purge-archive";

const run = new Date("2026-09-30T05:40:12.345Z");

test("una ruta purgada lleva la marca de la corrida, y solo la última", () => {
  assert.equal(
    purgedPath("2026-09-19T05-40-12Z/0001", run),
    "2026-09-19T05-40-12Z/0001.p2026-09-30T05-40-12Z",
  );
  assert.equal(
    purgedPath("2026-09-19T05-40-12Z/0001.p2026-09-22T05-40-12Z", run),
    "2026-09-19T05-40-12Z/0001.p2026-09-30T05-40-12Z",
  );
  assert.equal(
    purgedPath("seasons/s41/2026-09-26T12-19-55Z/character_activity-0001.ndjson.gz", run),
    "seasons/s41/2026-09-26T12-19-55Z/character_activity-0001.p2026-09-30T05-40-12Z.ndjson.gz",
  );
  assert.equal(
    purgedPath(
      "seasons/s41/2026-09-26T12-19-55Z/character_activity-0001.p2026-09-22T05-40-12Z.ndjson.gz",
      run,
    ),
    "seasons/s41/2026-09-26T12-19-55Z/character_activity-0001.p2026-09-30T05-40-12Z.ndjson.gz",
  );
});

test("un lote pierde las filas del borrado, y su gear y talentos con ellas", () => {
  const filtered = withoutCharacters(
    {
      snapshots: [
        { id: "1", character_id: "gone", captured_at: "2026-09-01T00:00:00.000Z" },
        { id: "2", character_id: "stays", captured_at: "2026-09-02T00:00:00.000Z" },
      ],
      gear: [{ snapshot_id: "1" }, { snapshot_id: "1" }, { snapshot_id: "2" }],
      talents: [{ snapshot_id: "1" }],
    },
    new Set(["gone"]),
  );

  assert.deepEqual(
    filtered.snapshots.map((row) => row.id),
    ["2"],
  );
  assert.deepEqual(filtered.gear, [{ snapshot_id: "2" }]);
  assert.deepEqual(filtered.talents, []);
  assert.equal(filtered.removedSnapshots, 1);
  assert.equal(filtered.removedGear, 2);
  assert.equal(filtered.removedTalents, 1);
});

test("de una temporada cerrada solo se miran los ficheros con personajes", () => {
  assert.deepEqual(
    seasonCharacterFile("seasons/s41/2026-09-26T12-19-55Z/character_presence-0003.ndjson.gz"),
    { seasonId: 41, table: "character_presence" },
  );
  assert.deepEqual(
    seasonCharacterFile(
      "seasons/s41/2026-09-26T12-19-55Z/character_activity-0001.p2026-09-30T05-40-12Z.ndjson.gz",
    ),
    { seasonId: 41, table: "character_activity" },
  );
  assert.equal(
    seasonCharacterFile("seasons/s41/2026-09-26T12-19-55Z/aggregate_snapshots-0001.ndjson.gz"),
    null,
  );
});

test("los objetos del índice se reconocen por temporada y shard", () => {
  assert.deepEqual(ratingIndexObject("rating-history/s42/3f.json.gz"), {
    seasonId: 42,
    shard: "3f",
  });
  assert.equal(ratingIndexObject("rating-history/s42/3f.json"), null);
  assert.equal(ratingIndexObject("2026-09-19T05-40-12Z/0001/character_snapshots.ndjson.gz"), null);
});

test("opciones de la purga", () => {
  assert.deepEqual(parsePurgeOptions([]), { force: false, dryRun: false });
  assert.deepEqual(parsePurgeOptions(["--force", "--dry-run"]), { force: true, dryRun: true });
  assert.throws(() => parsePurgeOptions(["--days"]), /Opción desconocida/);
});
