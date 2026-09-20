import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import { readLatestTalents } from "./talents";

const CAPTURED_AT = new Date("2026-08-28T04:12:00Z");

const KEY = {
  region: "eu",
  realmSlug: "sanguino",
  nameSlug: "ánatorey",
  bracket: "shuffle-mage-frost",
  seasonId: 42,
} as const;

function talentRow(overrides: Record<string, unknown> = {}) {
  return {
    tree: "spec",
    node_id: 99846,
    talent_name: "Toque gélido",
    rank: 1,
    captured_at: CAPTURED_AT,
    source: "profile",
    ...overrides,
  };
}

describe("readLatestTalents", () => {
  it("pide el último snapshot que traía nodos, no el último a secas", async () => {
    const db = fakeDb([talentRow()]);
    await readLatestTalents(db, KEY);

    // Misma razón que en el equipo: el leaderboard inserta filas sin loadout
    // cada vez que cambia el rating.
    assert.match(db.calls[0]?.text ?? "", /exists \(select 1 from character_snapshot_talents/);
  });

  it("devuelve el nodo del catálogo como talentId, no la etiqueta", async () => {
    // Es la clave con la que la fila se cruza contra el agregado, y desde el
    // ADR 0035 la fila guarda el id de etiqueta: devolver ese en su lugar
    // cruzaría contra nada y la marca de "lo llevas" no aparecería nunca.
    const db = fakeDb([talentRow()]);
    const read = await readLatestTalents(db, KEY);

    assert.equal(read?.nodes[0]?.talentId, 99846);
  });

  it("empareja cada etiqueta con su rango abriendo los dos arrays a la vez", async () => {
    // Dos unnest separados harían el producto cartesiano de etiquetas y rangos,
    // y el rango que le tocara a cada nodo dependería del planificador.
    const db = fakeDb([talentRow()]);
    await readLatestTalents(db, KEY);

    assert.match(db.calls[1]?.text ?? db.calls[0]?.text ?? "", /unnest\(t\.label_ids, t\.ranks\)/);
  });

  it("un nodo sin nombre sigue siendo un nodo observado", async () => {
    const db = fakeDb([talentRow({ talent_name: null })]);
    const read = await readLatestTalents(db, KEY);

    assert.equal(read?.nodes[0]?.talentName, null);
    assert.equal(read?.nodes.length, 1);
  });

  it("sin ninguna observación con loadout devuelve null, no una lista vacía", async () => {
    // La diferencia importa arriba: con null no se marca ningún nodo, porque no
    // haber mirado no es lo mismo que no llevarlo.
    const db = fakeDb([]);
    assert.equal(await readLatestTalents(db, KEY), null);
  });

  it("declara de qué observación vienen los nodos", async () => {
    const db = fakeDb([talentRow()]);
    const read = await readLatestTalents(db, KEY);

    assert.equal(read?.provenance.observedAt, CAPTURED_AT);
    assert.equal(read?.provenance.source, "profile");
  });
});
