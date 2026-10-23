import assert from "node:assert/strict";
import { test } from "node:test";
import {
  batchPrefix,
  candidatesSql,
  orphansSql,
  parseOptions,
  sqlTimestamp,
} from "./archive-snapshots";

test("por defecto se quedan 3 días, los de la caché de JSON del leaderboard", () => {
  assert.deepEqual(parseOptions([], 3), { days: 3, batch: 20_000, dryRun: false });
  assert.deepEqual(parseOptions(["--days", "30", "--batch", "500", "--dry-run"], 3), {
    days: 30,
    batch: 500,
    dryRun: true,
  });
  // Una caché más larga arrastra el valor por defecto con ella.
  assert.equal(parseOptions([], 5).days, 5);
});

test("no se archiva lo que todavía se podría reingerir desde la caché", () => {
  assert.throws(() => parseOptions(["--days", "2"], 3), /caché del leaderboard/);
  assert.throws(() => parseOptions(["--days", "0"], 3), /entero positivo/);
  assert.throws(() => parseOptions(["--window", "14"], 3), /Opción desconocida/);
});

test("cada lote tiene su propia carpeta, sin dos puntos", () => {
  const run = new Date("2026-09-19T05:40:12.345Z");

  assert.equal(batchPrefix(run, 0), "2026-09-19T05-40-12Z/0001");
  assert.equal(batchPrefix(run, 41), "2026-09-19T05-40-12Z/0042");
});

test("el corte se escribe como literal de fecha", () => {
  assert.equal(
    sqlTimestamp(new Date("2026-09-05T05:40:12.345Z")),
    "'2026-09-05T05:40:12.345Z'::timestamptz",
  );
});

test("el pico ya no retiene su fila: lo hereda la actividad (ADR 0053)", () => {
  const sql = candidatesSql(new Date("2026-10-23T00:00:00Z"), []);

  assert.doesNotMatch(sql, /rating desc/);
  assert.match(sql, /\) anchor/);
  assert.match(sql, /\) last_gear/);
  assert.match(sql, /\) last_talents/);
});

test("un catálogo se poda contra los ids desplegados una vez, no fila a fila", () => {
  const sql = orphansSql({ observation: "character_snapshot_gear", refs: "piece_ids" });

  assert.equal(
    sql.with,
    "with used as (select distinct unnest(piece_ids) as id from character_snapshot_gear)",
  );
  assert.equal(sql.where, "not exists (select 1 from used where used.id = t.id)");
  assert.doesNotMatch(`${sql.with} ${sql.where}`, /any\(/);
});

test("el ancla de leaderboard solo sale si la presencia la copia y la actividad tiene su contador", () => {
  const sql = candidatesSql(new Date("2026-10-23T00:00:00Z"), []);

  assert.match(sql, /anchor\.source = 'leaderboard'/);
  assert.match(sql, /p\.changed_at = anchor\.captured_at/);
  assert.match(sql, /a\.leaderboard_observed_at >= anchor\.captured_at/);
  // Las dos condiciones a la vez: la presencia sola no le basta a la actividad.
  assert.match(sql, /where not \(\s+anchor\.source = 'leaderboard'\s+and exists[\s\S]+and exists/);
});
