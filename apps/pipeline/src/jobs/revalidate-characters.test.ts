import assert from "node:assert/strict";
import { test } from "node:test";
import type { BlizzardResponse } from "@wowpvp/blizzard";
import {
  actionFor,
  parseOptions,
  statusPath,
  statusVerdict,
  type CharacterStatusResponse,
} from "./revalidate-characters";

const ok = (data: CharacterStatusResponse): BlizzardResponse<CharacterStatusResponse> => ({
  ok: true,
  status: 200,
  data,
});
const failed = (
  status: number,
  unavailable?: "quota" | "deadline",
): BlizzardResponse<CharacterStatusResponse> => ({
  ok: false,
  status,
  data: null,
  ...(unavailable ? { unavailable } : {}),
});

test("solo is_valid con el mismo id cuenta como prueba de existencia", () => {
  assert.deepEqual(statusVerdict(ok({ id: 7, is_valid: true }), 7), {
    kind: "exists",
    blizzardId: 7,
  });
  // Sin id guardado no hay con qué comparar: existe, y se aprende el id.
  assert.deepEqual(statusVerdict(ok({ id: 7, is_valid: true }), null), {
    kind: "exists",
    blizzardId: 7,
  });
  // Un 200 que no dice is_valid no es un sí (regla 5).
  assert.equal(statusVerdict(ok({ id: 7 }), 7).kind, "unknown");
});

test("is_valid falso u otro id es otro personaje, y se borra", () => {
  assert.deepEqual(statusVerdict(ok({ id: 7, is_valid: false }), 7), {
    kind: "gone",
    reason: "invalid",
  });
  assert.deepEqual(statusVerdict(ok({ id: 8, is_valid: true }), 7), {
    kind: "gone",
    reason: "id-changed",
  });
});

test("no se pudo mirar no es no existe", () => {
  assert.equal(statusVerdict(failed(404), 7).kind, "missing");
  assert.deepEqual(statusVerdict(failed(503), 7), { kind: "unknown", detail: "HTTP 503" });
  assert.deepEqual(statusVerdict(failed(0, "quota"), 7), { kind: "unknown", detail: "quota" });
  // Un 404 con `unavailable` no lo dijo Blizzard.
  assert.equal(statusVerdict(failed(404, "deadline"), 7).kind, "unknown");
});

test("un 404 se anota y solo el segundo, horas después, borra", () => {
  const now = new Date("2026-09-30T01:30:00Z");
  const missing = { kind: "missing" } as const;

  assert.deepEqual(actionFor(missing, null, now), { kind: "strike" });
  assert.deepEqual(actionFor(missing, new Date("2026-09-29T05:00:00Z"), now), {
    kind: "erase",
    reason: "not-found",
  });
  // Dos 404 en la misma caída de Blizzard no son dos pruebas.
  assert.deepEqual(actionFor(missing, new Date("2026-09-30T00:00:00Z"), now), { kind: "none" });
});

test("el resto de veredictos no dependen de un 404 anterior", () => {
  const now = new Date("2026-09-30T01:30:00Z");
  const since = new Date("2026-09-29T00:00:00Z");
  assert.deepEqual(actionFor({ kind: "exists", blizzardId: 7 }, since, now), {
    kind: "verify",
    blizzardId: 7,
  });
  assert.deepEqual(actionFor({ kind: "gone", reason: "invalid" }, null, now), {
    kind: "erase",
    reason: "invalid",
  });
  assert.deepEqual(actionFor({ kind: "unknown", detail: "HTTP 500" }, since, now), {
    kind: "none",
  });
});

test("la ruta de estado lleva el nombre canónico codificado", () => {
  assert.equal(
    statusPath("confrérie-du-thorium", "ánatorey"),
    "/profile/wow/character/confr%C3%A9rie-du-thorium/%C3%A1natorey/status",
  );
});

test("opciones del barrido", () => {
  assert.deepEqual(parseOptions([], 20_000), { budget: 20_000, dryRun: false });
  assert.deepEqual(parseOptions(["--budget", "500", "--dry-run"], 20_000), {
    budget: 500,
    dryRun: true,
  });
  assert.throws(() => parseOptions(["--budget", "0"], 20_000), /entero positivo/);
  assert.throws(() => parseOptions(["--days", "3"], 20_000), /Opción desconocida/);
});
