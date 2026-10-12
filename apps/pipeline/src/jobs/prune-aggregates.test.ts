import assert from "node:assert/strict";
import { test } from "node:test";
import { keptRunsSql, parseOptions } from "./prune-aggregates";

test("sin opciones conserva cuatro semanas de corridas semanales con cinco usuarios o más", () => {
  assert.deepEqual(parseOptions([]), { minUsers: 5, weeks: 4, dryRun: false });
});

test("--weeks, --min-users y --dry-run se leen; lo demás se rechaza", () => {
  assert.deepEqual(parseOptions(["--weeks", "8", "--min-users", "3", "--dry-run"]), {
    minUsers: 3,
    weeks: 8,
    dryRun: true,
  });
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
