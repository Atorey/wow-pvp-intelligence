import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "./compact";

test("sin opciones compacta todo lo de public por encima de 5 MB", () => {
  assert.deepEqual(parseOptions([]), { tables: [], minMb: 5, dryRun: false });
});

test("--tables acepta identificadores y nada más, porque acaban dentro del VACUUM", () => {
  assert.deepEqual(parseOptions(["--tables", "character_snapshots,characters"]).tables, [
    "character_snapshots",
    "characters",
  ]);
  assert.throws(() => parseOptions(["--tables", "x; drop table characters"]), /lista de tablas/);
  assert.throws(() => parseOptions(["--tables", "Characters"]), /lista de tablas/);
  assert.throws(() => parseOptions(["--tables"]), /lista de tablas/);
});

test("--min-mb y --dry-run se leen; lo demás se rechaza", () => {
  assert.deepEqual(parseOptions(["--min-mb", "0", "--dry-run"]), {
    tables: [],
    minMb: 0,
    dryRun: true,
  });
  assert.throws(() => parseOptions(["--min-mb", "-1"]), /no negativo/);
  assert.throws(() => parseOptions(["--full"]), /Opción desconocida/);
});
