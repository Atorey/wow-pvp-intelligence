import assert from "node:assert/strict";
import { test } from "node:test";
import { keptRunsSql, parseOptions, retentionSql } from "./prune-aggregates";

test("sin opciones conserva cuatro semanas de corridas semanales con cinco usuarios o más", () => {
  assert.deepEqual(parseOptions([]), { minUsers: 5, weeks: 4, logDays: 30, dryRun: false });
});

test("--weeks, --min-users y --dry-run se leen; lo demás se rechaza", () => {
  assert.deepEqual(
    parseOptions(["--weeks", "8", "--min-users", "3", "--log-days", "14", "--dry-run"]),
    { minUsers: 3, weeks: 8, logDays: 14, dryRun: true },
  );
  assert.throws(() => parseOptions(["--log-days", "0"]), /--log-days pide un entero/);
  assert.throws(() => parseOptions(["--weeks", "0"]), /--weeks pide un entero/);
  assert.throws(() => parseOptions(["--weeks", "1.5"]), /--weeks pide un entero/);
  assert.throws(() => parseOptions(["--weeks"]), /--weeks pide un entero/);
  assert.throws(() => parseOptions(["--days", "3"]), /Opción desconocida/);
});

test("las semanas se cuentan desde la corrida vigente, no desde ahora", () => {
  const sql = keptRunsSql(4);
  assert.match(
    sql,
    /\(select max\(computed_at\) from population_segments\)\s+- make_interval\(weeks => 4\)/,
  );
  assert.doesNotMatch(sql, /now\(\)/);
});

test("keptRunsSql solo admite enteros positivos, porque las semanas entran como literal", () => {
  assert.throws(() => keptRunsSql(0), /entero ≥ 1/);
  assert.throws(() => keptRunsSql(2.5), /entero ≥ 1/);
  assert.throws(() => keptRunsSql(Number.NaN), /entero ≥ 1/);
});

test("las ventanas de retención se cuentan desde la última fila de cada tabla, no desde ahora", () => {
  const sql = retentionSql(4, 30);
  assert.match(
    sql.population_segments,
    /\(select max\(computed_at\) from population_segments\)\s+- make_interval\(weeks => 4\)/,
  );
  assert.match(
    sql.leaderboard_fetches,
    /\(select max\(fetched_at\) from leaderboard_fetches\)\s+- make_interval\(days => 30\)/,
  );
  assert.match(
    sql.segment_coverage,
    /\(select max\(computed_at\) from segment_coverage\)\s+- make_interval\(days => 30\)/,
  );
  for (const where of Object.values(sql)) assert.doesNotMatch(where, /now\(\)/);
});

test("de population_segments no sale una fila con agregados ni la última de su escalón", () => {
  const where = retentionSql(4, 30).population_segments;
  assert.match(
    where,
    /not exists \(select 1 from aggregate_snapshots a where a\.population_segment_id = t\.id\)/,
  );
  assert.match(where, /newer\.computed_at > t\.computed_at/);
  for (const column of [
    "region",
    "season_id",
    "bracket",
    "class_slug",
    "spec_slug",
    "segment_id",
  ]) {
    assert.match(where, new RegExp(`newer\.${column} = t\.${column}`));
  }
});

test("de leaderboard_fetches se conserva la última descarga buena de cada hash", () => {
  const where = retentionSql(4, 30).leaderboard_fetches;
  assert.match(where, /where content_hash is not null/);
  assert.match(where, /where population_hash is not null/);
  assert.match(where, /distinct on \(region, season_id, bracket\)/);
});

test("retentionSql solo admite enteros positivos, porque las ventanas entran como literal", () => {
  assert.throws(() => retentionSql(0, 30), /weeks tiene que ser un entero ≥ 1/);
  assert.throws(() => retentionSql(4, 0), /logDays tiene que ser un entero ≥ 1/);
  assert.throws(() => retentionSql(4, 1.5), /logDays tiene que ser un entero ≥ 1/);
});
