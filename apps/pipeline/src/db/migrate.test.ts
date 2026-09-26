import assert from "node:assert/strict";
import { test } from "node:test";
import { parseRehearse, sizeDiff } from "./migrate";

const MB = 1_048_576;

test("sin opciones se aplica; con --rehearse se ensaya; lo demás se rechaza", () => {
  assert.equal(parseRehearse([]), false);
  assert.equal(parseRehearse(["--rehearse"]), true);
  assert.throws(() => parseRehearse(["--dry-run"]), /Opción desconocida/);
});

test("una tabla recreada con el mismo nombre cuenta en el pico aunque se lea como una", () => {
  // Lo que hace 0022: renombra la tabla de gear, crea otra con su nombre, y
  // borra la vieja. Por nombre es una sola fila que baja; por oid, la nueva
  // convivió con la vieja hasta el commit.
  const before = [
    { oid: 1, name: "character_snapshot_gear", bytes: 168 * MB },
    { oid: 2, name: "characters", bytes: 50 * MB },
  ];
  const after = [
    { oid: 3, name: "character_snapshot_gear", bytes: 6 * MB },
    { oid: 4, name: "gear_pieces", bytes: 20 * MB },
    { oid: 2, name: "characters", bytes: 50 * MB },
  ];

  const diff = sizeDiff(before, after);

  assert.deepEqual(diff.changed, [
    { name: "character_snapshot_gear", before: 168 * MB, after: 6 * MB },
    { name: "gear_pieces", before: null, after: 20 * MB },
  ]);
  assert.equal(diff.before, 218 * MB);
  assert.equal(diff.after, 76 * MB);
  assert.equal(diff.peak, 244 * MB);
});
