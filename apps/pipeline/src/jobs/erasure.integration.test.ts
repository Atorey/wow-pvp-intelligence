/**
 * El borrado de quien ya no existe, contra una Postgres de verdad (ADR 0043).
 *
 * Lo que aquí se prueba es SQL que ningún ejecutor falso cubre: que el nombre
 * reciclado no herede el histórico, que el borrado alcance a la bitácora de
 * búsquedas, y que la purga reescriba el archivo y la bitácora de lotes sin
 * dejar nada atrás. Storage es el falso de `@wowpvp/storage`; Postgres no.
 *
 * Usa una base propia, creada desde `TEST_DATABASE_URL`, y no la de esa
 * variable: los demás tests de integración vacían `characters` al arrancar, y
 * corren a la vez que este.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";
import type pg from "pg";
import { ratingHistoryPath, seriesKey } from "@wowpvp/core";
import { eraseCharacters, upsertCharacters, type CharacterIdentity } from "@wowpvp/blizzard";
import { readRatingHistoryShard } from "@wowpvp/storage";
import { FAKE_STORAGE, fakeStorage } from "@wowpvp/storage/fake-storage";
import { applyMigrations } from "../db/migrate";
import { createPool } from "../db/pool";
import { decodeRows, encodeRows } from "../storage";
import { batchObjectPaths } from "./archive-snapshots";
import { indexRatingHistory } from "./rating-history";
import { purge, purgedPath } from "./purge-archive";
import { isLocalDatabase } from "./seed";

const TEST_DATABASE_URL = process.env["TEST_DATABASE_URL"];

const skip = !TEST_DATABASE_URL
  ? "TEST_DATABASE_URL no está definida: hace falta una Postgres local y desechable"
  : !isLocalDatabase(TEST_DATABASE_URL)
    ? "TEST_DATABASE_URL no apunta a esta máquina"
    : false;

const DATABASE = "wowpvp_test_erasure";
const REGION = "eu";
const DAY = 86_400_000;

function identity(nameSlug: string, blizzardCharacterId: number | null): CharacterIdentity {
  return {
    realmSlug: "sanguino",
    nameSlug,
    nameDisplay: nameSlug,
    faction: null,
    blizzardCharacterId,
  };
}

describe("borrado y purga contra Postgres", { skip }, () => {
  let admin: pg.Pool;
  let pool: pg.Pool;

  before(async () => {
    admin = createPool(TEST_DATABASE_URL as string);
    await admin.query(`drop database if exists ${DATABASE}`);
    await admin.query(`create database ${DATABASE}`);
    const url = new URL(TEST_DATABASE_URL as string);
    url.pathname = `/${DATABASE}`;
    pool = createPool(url.toString());

    const log = console.log;
    console.log = (): void => {};
    try {
      await applyMigrations(pool);
    } finally {
      console.log = log;
    }
  });

  after(async () => {
    await pool?.end();
    await admin?.query(`drop database if exists ${DATABASE}`).catch(() => {});
    await admin?.end();
  });

  async function upsert(identities: CharacterIdentity[], at: Date): Promise<Map<string, string>> {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const ids = await upsertCharacters(client, REGION, identities, at);
      await client.query("commit");
      return ids;
    } finally {
      client.release();
    }
  }

  it("un nombre reciclado no hereda el histórico del anterior", async () => {
    const now = new Date();
    const [first] = (await upsert([identity("recycled", 1)], now)).values();
    await pool.query(
      `insert into character_snapshots
         (character_id, source, season_id, bracket, class_slug, spec_slug, rating)
       values ($1, 'leaderboard', 42, 'shuffle-mage-frost', 'mage', 'frost', 1800)`,
      [first],
    );
    await pool.query(
      `insert into character_lookups (region, realm_slug, name_slug, requested_at, outcome, character_id)
       values ($1, 'sanguino', 'recycled', now(), 'ok', $2)`,
      [REGION, first],
    );

    const [second] = (await upsert([identity("recycled", 2)], now)).values();
    assert.notEqual(second, first);

    const { rows: erasures } = await pool.query(
      "select reason from character_erasures where character_id = $1",
      [first],
    );
    assert.deepEqual(erasures, [{ reason: "id-changed" }]);
    const { rows: left } = await pool.query(
      `select (select count(*)::int from character_snapshots where character_id = $1) as snapshots,
              (select count(*)::int from character_lookups where name_slug = 'recycled') as lookups`,
      [first],
    );
    assert.deepEqual(left, [{ snapshots: 0, lookups: 0 }]);
  });

  it("la prueba de existencia solo avanza y anula un 404 pendiente", async () => {
    const recent = new Date();
    const [id] = (await upsert([identity("verified", 3)], recent)).values();
    await pool.query("update characters set missing_since = now() where id = $1", [id]);

    // Reingerir un fichero viejo de la caché no la retrasa.
    await upsert([identity("verified", 3)], new Date(recent.getTime() - 5 * DAY));
    const { rows } = await pool.query<{ verified_at: Date; missing_since: Date | null }>(
      "select verified_at, missing_since from characters where id = $1",
      [id],
    );
    assert.equal(rows[0]?.verified_at.getTime(), recent.getTime());
    assert.equal(rows[0]?.missing_since, null);
  });

  it("el barrido no borra a quien tiene una prueba posterior a su pregunta", async () => {
    const [id] = (await upsert([identity("seen-meanwhile", 4)], new Date())).values();
    const client = await pool.connect();
    try {
      await client.query("begin");
      const erased = await eraseCharacters(client, [id as string], "not-found", {
        verifiedBefore: new Date(Date.now() - 18 * DAY),
      });
      await client.query("commit");
      assert.deepEqual(erased, []);
    } finally {
      client.release();
    }
    const { rows } = await pool.query("select 1 from characters where id = $1", [id]);
    assert.equal(rows.length, 1);
  });

  it("la purga saca al borrado de lotes, temporadas e índice, y se puede repetir", async () => {
    const now = new Date();
    const { fetchFn, objects } = fakeStorage();
    const gone = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
    const stays = "3f000000-0000-4000-8000-000000000000";
    const prefix = "2026-09-01T05-40-12Z/0001";

    // Un lote con los dos, y el gear de cada uno.
    const [snapshotsPath, gearPath] = batchObjectPaths(prefix) as [string, string, string];
    objects.set(
      snapshotsPath,
      encodeRows([
        { id: "1", character_id: gone, captured_at: "2026-08-20T10:00:00.000Z", rating: 1700 },
        { id: "2", character_id: stays, captured_at: "2026-08-21T10:00:00.000Z", rating: 1600 },
      ]),
    );
    objects.set(gearPath, encodeRows([{ snapshot_id: "1" }, { snapshot_id: "2" }]));
    await pool.query(
      `insert into snapshot_archive_batches
         (object_prefix, cutoff, snapshots, gear_rows, talent_rows, first_captured_at, last_captured_at)
       values ($1, $2, 2, 2, 0, '2026-08-20T10:00:00Z', '2026-08-21T10:00:00Z')`,
      [prefix, now],
    );

    // Un fichero de presencia de una temporada cerrada.
    const seasonPath = "seasons/s41/2026-09-26T12-19-55Z/character_presence-0001.ndjson.gz";
    objects.set(seasonPath, encodeRows([{ character_id: gone }, { character_id: stays }]));
    await pool.query(
      `insert into archived_seasons (season_id, object_prefix, presence_rows)
       values (41, 'seasons/s41/2026-09-26T12-19-55Z', 2)`,
    );

    // Y su serie en el índice de rating.
    await indexRatingHistory(
      FAKE_STORAGE,
      [gone, stays].map((characterId) => ({
        characterId,
        bracket: "shuffle-mage-frost",
        seasonId: 42,
        at: new Date("2026-08-20T10:00:00Z"),
        rating: 1700,
      })),
      fetchFn,
    );

    await pool.query(
      `insert into character_erasures (character_id, last_verified_at, reason)
       values ($1, $2, 'not-found')`,
      [gone, new Date(now.getTime() - 25 * DAY)],
    );

    const client = await pool.connect();
    try {
      const report = await purge(
        client,
        FAKE_STORAGE,
        { force: false, dryRun: false },
        now,
        fetchFn,
      );
      assert.equal(report.batchesRewritten, 1);
      assert.equal(report.snapshots, 1);
      assert.equal(report.gearRows, 1);
      assert.equal(report.seasonRows, 1);
      assert.equal(report.indexSeries, 1);

      // La bitácora apunta al lote nuevo, con lo que tiene de verdad.
      const newPrefix = purgedPath(prefix, now);
      const { rows: batches } = await client.query(
        "select object_prefix, snapshots, gear_rows from snapshot_archive_batches",
      );
      assert.deepEqual(batches, [{ object_prefix: newPrefix, snapshots: 1, gear_rows: 1 }]);
      const kept = decodeRows<{ character_id: string }>(
        objects.get(`${newPrefix}/character_snapshots.ndjson.gz`) as Buffer,
      );
      assert.deepEqual(
        kept.map((row) => row.character_id),
        [stays],
      );

      // Lo viejo ya no está, ni queda nada anotado.
      assert.equal(objects.has(snapshotsPath), false);
      assert.equal(objects.has(seasonPath), false);
      assert.equal(objects.has(purgedPath(seasonPath, now)), true);
      const { rows: garbage } = await client.query("select * from archive_garbage");
      assert.deepEqual(garbage, []);

      const shard = await readRatingHistoryShard(FAKE_STORAGE, 42, "3f", fetchFn);
      assert.equal(shard?.series.has(seriesKey(gone, "shuffle-mage-frost")), false);
      assert.equal(shard?.series.has(seriesKey(stays, "shuffle-mage-frost")), true);
      assert.ok(objects.has(ratingHistoryPath(42, "3f")));

      const { rows: seasons } = await client.query(
        "select presence_rows from archived_seasons where season_id = 41",
      );
      assert.deepEqual(seasons, [{ presence_rows: 1 }]);
      const { rows: erasures } = await client.query(
        "select purged_at is not null as purged from character_erasures where character_id = $1",
        [gone],
      );
      assert.deepEqual(erasures, [{ purged: true }]);

      // Repetirla no encuentra nada que hacer.
      const again = await purge(client, FAKE_STORAGE, { force: true, dryRun: false }, now, fetchFn);
      assert.equal(again.batchesRewritten, 0);
    } finally {
      client.release();
    }
  });

  it("la purga espera mientras nada esté cerca de su plazo", async () => {
    const now = new Date();
    await pool.query(
      `insert into character_erasures (character_id, last_verified_at, reason)
       values ('a1b2c3d4-0000-4000-8000-000000000000', $1, 'invalid')`,
      [new Date(now.getTime() - 2 * DAY)],
    );
    const { fetchFn } = fakeStorage();
    const client = await pool.connect();
    try {
      const report = await purge(
        client,
        FAKE_STORAGE,
        { force: false, dryRun: false },
        now,
        fetchFn,
      );
      assert.equal(report.skipped, true);
    } finally {
      client.release();
    }
  });
});
