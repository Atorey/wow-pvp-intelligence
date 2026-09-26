import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { decodeRows, encodeRows } from "./storage";

test("las filas vuelven intactas del NDJSON comprimido, arrays y nulos incluidos", () => {
  const rows = [
    { id: "9007199254740993", gem_item_ids: [1, 2], talent_loadout_code: null },
    { id: "2", gem_item_ids: [], talent_loadout_code: "abc" },
  ];

  const lines = gunzipSync(encodeRows(rows)).toString("utf8").trimEnd().split("\n");

  assert.deepEqual(
    lines.map((line) => JSON.parse(line)),
    rows,
  );
  assert.deepEqual(decodeRows(encodeRows(rows)), rows);
});

test("un lote vacío se lee como ninguna fila", () => {
  assert.deepEqual(decodeRows(encodeRows([])), []);
});
