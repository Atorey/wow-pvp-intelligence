import assert from "node:assert/strict";
import { test } from "node:test";
import { batchPrefix, parseOptions, sqlTimestamp } from "./archive-snapshots";

test("por defecto se quedan los 14 días de la ventana de actividad más larga", () => {
  assert.deepEqual(parseOptions([]), { days: 14, batch: 20_000, dryRun: false });
  assert.deepEqual(parseOptions(["--days", "30", "--batch", "500", "--dry-run"]), {
    days: 30,
    batch: 500,
    dryRun: true,
  });
});

test("no se puede archivar dentro de la ventana con la que se agrega", () => {
  assert.throws(() => parseOptions(["--days", "7"]), /ventana de actividad/);
  assert.throws(() => parseOptions(["--days", "0"]), /entero positivo/);
  assert.throws(() => parseOptions(["--window", "14"]), /Opción desconocida/);
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
