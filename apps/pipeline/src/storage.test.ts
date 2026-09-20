import assert from "node:assert/strict";
import { test } from "node:test";
import { gunzipSync } from "node:zlib";
import { encodeRows, ensureBucket, supabaseUrlFrom, uploadObject } from "./storage";

const CONFIG = { url: "https://ref.supabase.co", serviceKey: "secreta", bucket: "archivo" };

interface Call {
  url: string;
  init: RequestInit | undefined;
}

function fakeFetch(responses: Response[]): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) throw new Error("llamada de más");
    return next;
  }) as typeof fetch;
  return { fetchFn, calls };
}

test("la URL del proyecto sale del usuario del pooler o del host directo", () => {
  assert.equal(
    supabaseUrlFrom(
      "postgresql://postgres.abc123:pw@aws-0-eu-west-2.pooler.supabase.com:5432/postgres",
    ),
    "https://abc123.supabase.co",
  );
  assert.equal(
    supabaseUrlFrom("postgresql://postgres:pw@db.abc123.supabase.co:5432/postgres"),
    "https://abc123.supabase.co",
  );
});

test("fuera de Supabase no se adivina el proyecto", () => {
  assert.equal(supabaseUrlFrom("postgres://postgres:postgres@localhost:5432/wowpvp"), null);
  // Un usuario con forma de pooler en otro host no es un proyecto de Supabase.
  assert.equal(supabaseUrlFrom("postgres://postgres.abc123:pw@example.com:5432/x"), null);
  assert.equal(supabaseUrlFrom("no es una url"), null);
});

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
});

test("la subida nunca sobrescribe: un objeto que ya existe es un error", async () => {
  const { fetchFn, calls } = fakeFetch([new Response("Duplicate", { status: 409 })]);

  await assert.rejects(
    uploadObject(CONFIG, "2026/0001/character_snapshots.ndjson.gz", Buffer.from("x"), fetchFn),
    /409/,
  );
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["x-upsert"], "false");
  assert.equal(
    calls[0]?.url,
    `${CONFIG.url}/storage/v1/object/archivo/2026/0001/character_snapshots.ndjson.gz`,
  );
});

test("el bucket se crea privado si no existe", async () => {
  const { fetchFn, calls } = fakeFetch([
    new Response("not found", { status: 400 }),
    new Response("{}", { status: 200 }),
  ]);

  await ensureBucket(CONFIG, fetchFn);

  assert.equal(calls[1]?.init?.method, "POST");
  assert.deepEqual(JSON.parse(String(calls[1]?.init?.body)), {
    id: "archivo",
    name: "archivo",
    public: false,
  });
});

test("no se archiva nada en un bucket público", async () => {
  const { fetchFn } = fakeFetch([new Response(JSON.stringify({ public: true }), { status: 200 })]);

  await assert.rejects(ensureBucket(CONFIG, fetchFn), /público/);
});
