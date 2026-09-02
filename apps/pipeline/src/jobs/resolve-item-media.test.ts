import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { BlizzardResponse } from "@wowpvp/blizzard";
import {
  ITEM_MEDIA_TTL_DAYS,
  type ItemMediaResponse,
  type PendingItem,
  iconFrom,
  parseOptions,
  resolveItems,
} from "./resolve-item-media";

const RESOLVED_AT = new Date("2026-08-27T03:00:00Z");

/** Cliente de mentira: devuelve la respuesta que se le diga por item. */
function fakeClient(byItem: Record<number, BlizzardResponse<ItemMediaResponse>>) {
  const asked: string[] = [];
  return {
    asked,
    tryGet<T>(path: string): Promise<BlizzardResponse<T>> {
      asked.push(path);
      const id = Number(path.split("/").pop());
      const res = byItem[id] ?? { ok: false, status: 500, data: null };
      return Promise.resolve(res as BlizzardResponse<T>);
    },
  };
}

/** Base de mentira: solo apunta lo que se le manda escribir. */
function fakeDb() {
  const writes: { itemId: number; iconUrl: string | null }[] = [];
  return {
    writes,
    query(_text: string, values: unknown[] = []) {
      writes.push({ itemId: values[0] as number, iconUrl: values[1] as string | null });
      return Promise.resolve({ rows: [] });
    },
  };
}

function pending(...ids: number[]): PendingItem[] {
  return ids.map((itemId) => ({ itemId, isNew: true }));
}

const ICON = "https://render.worldofwarcraft.com/eu/icons/56/7384535.jpg";

describe("iconFrom", () => {
  it("busca el asset por clave en vez de coger el primero", () => {
    // La respuesta real de hoy trae un único asset, así que `assets[0]` pasaría
    // el test. Lo que se protege es el día que Blizzard meta otro delante.
    const media = {
      assets: [
        { key: "quality", value: "https://example.invalid/quality.png" },
        { key: "icon", value: ICON },
      ],
    };

    assert.equal(iconFrom(media), ICON);
  });

  it("devuelve null cuando la respuesta no trae icono", () => {
    assert.equal(iconFrom({ assets: [] }), null);
    assert.equal(iconFrom({}), null);
    assert.equal(iconFrom(null), null);
  });
});

describe("parseOptions", () => {
  it("por defecto revalida a los 30 días de la cláusula 2.s", () => {
    assert.equal(parseOptions([]).ttlDays, ITEM_MEDIA_TTL_DAYS);
    assert.equal(ITEM_MEDIA_TTL_DAYS, 30);
  });

  it("admite --ttl 0 como forma de revalidar el catálogo entero", () => {
    assert.equal(parseOptions(["--ttl", "0"]).ttlDays, 0);
  });

  it("rechaza un presupuesto que no sea un número de peticiones", () => {
    assert.throws(() => parseOptions(["--budget", "0"]), /--budget/);
    assert.throws(() => parseOptions(["--budget", "muchas"]), /--budget/);
    assert.throws(() => parseOptions(["--ttl", "-1"]), /--ttl/);
    assert.throws(() => parseOptions(["--iconos"]), /Opción desconocida/);
  });
});

describe("resolveItems", () => {
  it("guarda la URL que devuelve la Media API, sin descargar nada", async () => {
    const client = fakeClient({
      228858: { ok: true, status: 200, data: { assets: [{ key: "icon", value: ICON }] } },
    });
    const db = fakeDb();

    const report = await resolveItems(client, db, pending(228858), RESOLVED_AT);

    assert.deepEqual(client.asked, ["/data/wow/media/item/228858"]);
    assert.deepEqual(db.writes, [{ itemId: 228858, iconUrl: ICON }]);
    assert.equal(report.withIcon, 1);
  });

  it("recuerda el 404: preguntado y sin icono no se vuelve a preguntar", async () => {
    // Es lo que separa gastar una petición cada 30 días de gastarla cada
    // corrida. La fila se escribe con null, que es "no disponible" (regla 5).
    const client = fakeClient({ 1: { ok: false, status: 404, data: null } });
    const db = fakeDb();

    const report = await resolveItems(client, db, pending(1), RESOLVED_AT);

    assert.deepEqual(db.writes, [{ itemId: 1, iconUrl: null }]);
    assert.equal(report.withoutIcon, 1);
    assert.equal(report.errors, 0);
  });

  it("no recuerda un fallo transitorio: el item vuelve a estar pendiente", async () => {
    // Un 500 escrito como "sin icono" convertiría un problema de un minuto en
    // un hueco de treinta días en todas las páginas que lleven ese item.
    const client = fakeClient({ 228858: { ok: false, status: 500, data: null } });
    const db = fakeDb();

    const report = await resolveItems(client, db, pending(228858), RESOLVED_AT);

    assert.deepEqual(db.writes, []);
    assert.equal(report.errors, 1);
    assert.equal(report.withoutIcon, 0);
  });

  it("un 200 sin asset de icono también se recuerda", async () => {
    const client = fakeClient({ 228858: { ok: true, status: 200, data: { assets: [] } } });
    const db = fakeDb();

    const report = await resolveItems(client, db, pending(228858), RESOLVED_AT);

    assert.deepEqual(db.writes, [{ itemId: 228858, iconUrl: null }]);
    assert.equal(report.withoutIcon, 1);
  });

  it("un item que falla no corta la tanda", async () => {
    const client = fakeClient({
      1: { ok: false, status: 500, data: null },
      2: { ok: true, status: 200, data: { assets: [{ key: "icon", value: ICON }] } },
    });
    const db = fakeDb();

    const report = await resolveItems(client, db, pending(1, 2), RESOLVED_AT);

    assert.equal(report.errors, 1);
    assert.equal(report.withIcon, 1);
    assert.deepEqual(db.writes, [{ itemId: 2, iconUrl: ICON }]);
  });
});
