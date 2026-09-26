import assert from "node:assert/strict";
import { test } from "node:test";
import { downloadObject, ensureBucket, supabaseUrlFrom, uploadObject } from "./client";

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

test("la subida nunca sobrescribe si no se pide: un objeto que ya existe es un error", async () => {
  const { fetchFn, calls } = fakeFetch([new Response("Duplicate", { status: 409 })]);

  await assert.rejects(
    uploadObject(CONFIG, "2026/0001/character_snapshots.ndjson.gz", Buffer.from("x"), {}, fetchFn),
    /409/,
  );
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["x-upsert"], "false");
  assert.equal(
    calls[0]?.url,
    `${CONFIG.url}/storage/v1/object/archivo/2026/0001/character_snapshots.ndjson.gz`,
  );
});

test("el índice sí se sobrescribe, y solo porque lo pide", async () => {
  const { fetchFn, calls } = fakeFetch([new Response("{}", { status: 200 })]);

  await uploadObject(
    CONFIG,
    "rating-history/s42/3f.json.gz",
    Buffer.from("x"),
    { upsert: true },
    fetchFn,
  );

  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["x-upsert"], "true");
});

test("un objeto que no existe es null, en las dos formas en que Storage lo dice", async () => {
  const { fetchFn } = fakeFetch([
    new Response("not found", { status: 404 }),
    new Response(JSON.stringify({ statusCode: "404", error: "not_found" }), { status: 400 }),
  ]);

  assert.equal(await downloadObject(CONFIG, "a", fetchFn), null);
  assert.equal(await downloadObject(CONFIG, "b", fetchFn), null);
});

test("una caída al bajar es un error, no un objeto vacío", async () => {
  const { fetchFn } = fakeFetch([
    new Response("boom", { status: 500 }),
    new Response(JSON.stringify({ statusCode: "403", error: "Unauthorized" }), { status: 400 }),
  ]);

  await assert.rejects(downloadObject(CONFIG, "a", fetchFn), /500/);
  await assert.rejects(downloadObject(CONFIG, "b", fetchFn), /400/);
});

test("lo que se baja vuelve tal cual", async () => {
  const { fetchFn, calls } = fakeFetch([new Response(new Uint8Array([1, 2, 3]), { status: 200 })]);

  assert.deepEqual(
    await downloadObject(CONFIG, "rating-history/s42/3f.json.gz", fetchFn),
    Buffer.from([1, 2, 3]),
  );
  const headers = calls[0]?.init?.headers as Record<string, string>;
  assert.equal(headers["apikey"], "secreta");
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
