import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import { readLatestGear } from "./gear";

const CAPTURED_AT = new Date("2026-08-28T04:12:00Z");

const KEY = {
  region: "eu",
  realmSlug: "sanguino",
  nameSlug: "ánatorey",
  bracket: "shuffle-mage-frost",
  seasonId: 42,
} as const;

function gearRow(overrides: Record<string, unknown> = {}) {
  return {
    slot: "HEAD",
    item_id: "228812",
    item_name: "Capucha del Cónclave Galáctico",
    item_level: 252,
    quality: "EPIC",
    icon_url: "https://render.worldofwarcraft.com/eu/icons/56/inv_hood.jpg",
    captured_at: CAPTURED_AT,
    source: "profile",
    equipped_item_level: 263,
    ...overrides,
  };
}

describe("readLatestGear", () => {
  it("ordena por el catálogo de slots y no por el texto de la columna", async () => {
    const db = fakeDb([
      gearRow({ slot: "WRIST", item_id: "1" }),
      gearRow({ slot: "HEAD", item_id: "2" }),
      gearRow({ slot: "TABARD", item_id: "3" }),
      gearRow({ slot: "CHEST", item_id: "4" }),
    ]);

    const read = await readLatestGear(db, KEY);

    assert.deepEqual(read?.items.map((item) => item.slot), ["HEAD", "CHEST", "WRIST", "TABARD"]);
  });

  it("pide el último snapshot que traía equipo, no el último a secas", async () => {
    const db = fakeDb([gearRow()]);
    await readLatestGear(db, KEY);

    // El leaderboard inserta filas sin gear cada vez que cambia el rating: sin
    // este `exists`, el equipo saldría vacío para casi todo el mundo.
    assert.match(db.calls[0]?.text ?? "", /exists \(select 1 from character_snapshot_gear/);
  });

  it("un item sin icono resuelto sigue siendo un item", async () => {
    const db = fakeDb([gearRow({ icon_url: null, quality: "RARE" })]);
    const read = await readLatestGear(db, KEY);

    // El hueco del icono se reserva en pantalla (brief §4.5); lo que no puede
    // pasar es que la pieza desaparezca de la lista por no tener imagen.
    assert.equal(read?.items[0]?.iconUrl, null);
    assert.equal(read?.items[0]?.quality, "rare");
    assert.match(db.calls[0]?.text ?? "", /left join item_media/);
  });

  it("declara de qué observación viene el equipo, que no es la del rating", async () => {
    const db = fakeDb([gearRow()]);
    const read = await readLatestGear(db, KEY);

    assert.equal(read?.provenance.observedAt, CAPTURED_AT);
    assert.equal(read?.provenance.source, "profile");
  });

  it("trae el item level de esa misma observación, no el del último snapshot", async () => {
    // El último snapshot suele ser de leaderboard y no trae item level: leerlo
    // de ahí pintaría un guion al lado de una lista de dieciséis piezas.
    const db = fakeDb([gearRow({ equipped_item_level: 271 })]);
    const read = await readLatestGear(db, KEY);

    assert.equal(read?.equippedItemLevel, 271);
  });

  it("sin ninguna observación con equipo devuelve null, no una lista vacía", async () => {
    const db = fakeDb([]);
    assert.equal(await readLatestGear(db, KEY), null);
  });

  it("convierte el item_id de bigint a número", async () => {
    const db = fakeDb([gearRow({ item_id: "228812" })]);
    const read = await readLatestGear(db, KEY);

    assert.equal(read?.items[0]?.itemId, 228812);
  });
});
