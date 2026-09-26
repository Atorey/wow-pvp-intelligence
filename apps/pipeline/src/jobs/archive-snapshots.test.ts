import assert from "node:assert/strict";
import { test } from "node:test";
import { batchPrefix, parseOptions, sqlTimestamp } from "./archive-snapshots";

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
