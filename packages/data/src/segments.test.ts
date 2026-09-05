import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import {
  readAdoption,
  readAdoptionFor,
  readBracketSegments,
  readSegment,
  toSegmentRead,
} from "./segments";
import type { SegmentRow } from "./segments";

const COMPUTED_AT = new Date("2026-08-20T03:00:00Z");

/**
 * Una fila como las que hay hoy en la tabla: 3.000 personas de población y cero
 * perfiles con gear. Lleva la columna `confidence` con el valor que de verdad se
 * guardó —`high`— para que los tests puedan comprobar que no se lee.
 */
function row(overrides: Partial<SegmentRow> = {}): SegmentRow & { confidence: string } {
  return {
    id: "41",
    computed_at: COMPUTED_AT,
    region: "eu",
    season_id: 42,
    bracket: "shuffle-priest-holy",
    class_slug: "priest",
    spec_slug: "holy",
    segment_id: "1800-2000",
    segment_min: 1800,
    segment_max: 2000,
    activity_window_days: 7,
    sample_size: 3000,
    gear_sample: 0,
    talent_sample: 0,
    talent_node_sample: 0,
    pvp_talent_sample: 0,
    item_level_sample: 0,
    rating_median: "1897.5",
    rating_p25: "1840.0",
    rating_p75: "1955.0",
    rating_min: 1800,
    rating_max: 1999,
    equipped_item_level_median: "639.0",
    profile_data_from: null,
    profile_data_to: null,
    excluded_search: 4,
    active_by_delta: 120,
    active_by_first_seen: 2880,
    confidence: "high",
    ...overrides,
  };
}

describe("toSegmentRead", () => {
  it("no hereda la confianza de la columna: la deriva de cada denominador", () => {
    // La regresión de #76. La fila dice `high` porque mide población; la
    // comparación de gear se calculó sobre cero perfiles y no se puede enseñar.
    const read = toSegmentRead(row());

    assert.equal(read.population.confidence, "high");
    assert.equal(read.gear.confidence, "insufficient");
    assert.equal(read.talents.confidence, "insufficient");
    assert.equal(read.itemLevel.confidence, "insufficient");
  });

  it("separa las cuatro bases de cálculo en vez de colapsarlas", () => {
    const read = toSegmentRead(row({ sample_size: 400, gear_sample: 150, talent_sample: 31 }));

    assert.equal(read.population.denominator, 400);
    assert.equal(read.gear.denominator, 150);
    assert.equal(read.talents.denominator, 31);
    assert.equal(read.gear.confidence, "high");
    assert.equal(read.talents.confidence, "medium");
    // La población es contexto en las cuatro, no la base de ninguna salvo la suya.
    assert.equal(read.gear.sampleSize, 400);
  });

  it("convierte los numeric, que el driver devuelve como string", () => {
    const read = toSegmentRead(row());

    assert.equal(read.rating.median, 1897.5);
    assert.equal(read.rating.p25, 1840);
    assert.equal(read.equippedItemLevelMedian, 639);
  });

  it("traduce el tramo abierto de arriba a Infinity, como packages/core", () => {
    const read = toSegmentRead(row({ segment_id: "3000+", segment_min: 3000, segment_max: null }));

    assert.equal(read.segment.min, 3000);
    assert.equal(read.segment.max, Infinity);
  });

  it("mantiene null como 'no disponible' en las medianas sin muestra", () => {
    const read = toSegmentRead(row({ rating_median: null, equipped_item_level_median: null }));

    assert.equal(read.rating.median, null);
    assert.equal(read.equippedItemLevelMedian, null);
  });
});

describe("readSegment", () => {
  it("no pide la columna confidence en ninguna consulta de segmento", async () => {
    const db = fakeDb([row()]);
    await readSegment(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      segmentId: "1800-2000",
    });

    const [call] = db.calls;
    assert.ok(call);
    const selected = call.text.slice(0, call.text.indexOf("from"));
    assert.ok(!/\bconfidence\b/.test(selected), `la SELECT pide confidence:\n${selected}`);
    assert.ok(/\bgear_sample\b/.test(selected));
    assert.ok(/\btalent_node_sample\b/.test(selected));
    assert.ok(/\bpvp_talent_sample\b/.test(selected));
  });

  it("cada base de comparación deriva su confianza de su propio denominador", async () => {
    // Población de sobra, gear justo, nodos recién empezados: es el estado real
    // de los primeros días tras el ADR 0026, y leer una sola cifra lo taparía.
    const db = fakeDb([
      row({ sample_size: 3000, gear_sample: 120, talent_node_sample: 40, pvp_talent_sample: 0 }),
    ]);
    const read = await readSegment(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      segmentId: "1800-2000",
    });

    assert.equal(read?.population.confidence, "high");
    assert.equal(read?.gear.confidence, "high");
    assert.equal(read?.talentNodes.confidence, "medium");
    assert.equal(read?.pvpTalents.confidence, "insufficient");
  });

  it("pide el computed_at más alto, no el de hoy", async () => {
    const db = fakeDb([row()]);
    await readSegment(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      segmentId: "1800-2000",
    });

    const [call] = db.calls;
    assert.ok(call);
    assert.match(call.text, /order by computed_at desc/);
    assert.deepEqual(call.values, ["eu", 42, "shuffle-priest-holy", "1800-2000"]);
  });

  it("devuelve null cuando el par no se ha calculado nunca", async () => {
    const db = fakeDb([]);
    const read = await readSegment(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-warrior-arms",
      segmentId: "2600-2800",
    });

    assert.equal(read, null);
  });

  it("devuelve fila, no null, cuando el escalón existe con muestra insuficiente", async () => {
    // Es la diferencia que sostiene el ADR 0011: "no hay datos" y "hay 12
    // personas" se explican distinto, así que no pueden colapsar en null.
    const db = fakeDb([row({ sample_size: 12, gear_sample: 12 })]);
    const read = await readSegment(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
      segmentId: "1800-2000",
    });

    assert.ok(read);
    assert.equal(read.population.denominator, 12);
    assert.equal(read.gear.confidence, "insufficient");
  });
});

describe("readBracketSegments", () => {
  it("devuelve los escalones de una sola corrida", async () => {
    const db = fakeDb([row({ segment_id: "1600-1800" }), row({ segment_id: "1800-2000" })]);
    const reads = await readBracketSegments(db, {
      region: "eu",
      seasonId: 42,
      bracket: "shuffle-priest-holy",
    });

    assert.equal(reads.length, 2);
    const [call] = db.calls;
    assert.ok(call);
    assert.match(call.text, /computed_at = \(\s*select max\(computed_at\)/);
  });
});

describe("readAdoption", () => {
  const segment = toSegmentRead(row({ sample_size: 400, gear_sample: 150 }));

  it("hereda el computed_at del escalón y toma el denominador de la variable", async () => {
    const db = fakeDb([
      {
        variable_kind: "gear-item",
        variable_key: "228858",
        slot_group: "TRINKET_1",
        item_id: "228858",
        item_name: "Signet of the Priory",
        talent_tree: null,
        talent_id: null,
        talent_name: null,
        enchantment_id: null,
        enchantment_name: null,
        icon_url: "https://render.worldofwarcraft.com/eu/icons/56/7384535.jpg",
        users: 111,
        denominator: 148,
        unavailable: 2,
        adoption_rate: "0.75000000",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "gear-item");

    assert.ok(adoption);
    assert.equal(adoption.rate, 0.75);
    assert.equal(adoption.itemId, 228858);
    // El denominador es el de la fila (148), no el gear_sample del escalón (150).
    assert.equal(adoption.provenance.denominator, 148);
    assert.equal(adoption.provenance.sampleSize, 400);
    assert.equal(adoption.provenance.computedAt, segment.population.computedAt);
    assert.equal(adoption.provenance.confidence, "high");
  });

  it("deja unavailable fuera del denominador, sin contarlo como no-adopción", async () => {
    const db = fakeDb([
      {
        variable_kind: "talent-code",
        variable_key: "CEkAAA",
        slot_group: null,
        item_id: null,
        item_name: null,
        talent_tree: null,
        talent_id: null,
        talent_name: null,
        enchantment_id: null,
        enchantment_name: null,
        icon_url: null,
        users: 3,
        denominator: 40,
        unavailable: 110,
        adoption_rate: "0.07500000",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "talent-code");

    assert.ok(adoption);
    assert.equal(adoption.unavailable, 110);
    assert.equal(adoption.provenance.denominator, 40);
    assert.equal(adoption.itemId, null);
  });

  it("trae el icono del catálogo sin que el item lo lleve encima", async () => {
    // El icono no vive en aggregate_snapshots: se junta desde item_media (#67),
    // así que la fila de adopción no cambia de forma cuando se resuelve uno.
    const db = fakeDb([
      {
        variable_kind: "gear-item",
        variable_key: "228858",
        slot_group: "TRINKET_1",
        item_id: "228858",
        item_name: "Signet of the Priory",
        talent_tree: null,
        talent_id: null,
        talent_name: null,
        enchantment_id: null,
        enchantment_name: null,
        icon_url: "https://render.worldofwarcraft.com/eu/icons/56/7384535.jpg",
        users: 111,
        denominator: 148,
        unavailable: 2,
        adoption_rate: "0.75000000",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "gear-item");

    assert.ok(adoption);
    assert.equal(adoption.iconUrl, "https://render.worldofwarcraft.com/eu/icons/56/7384535.jpg");
  });

  it("sin icono resuelto devuelve null, y la adopción sigue saliendo", async () => {
    // El estado del brief §4.5: hueco reservado, no fila escondida. Por eso el
    // join es left y por eso null llega tal cual en vez de convertirse en "".
    const db = fakeDb([
      {
        variable_kind: "gear-item",
        variable_key: "228858",
        slot_group: "TRINKET_1",
        item_id: "228858",
        item_name: "Signet of the Priory",
        talent_tree: null,
        talent_id: null,
        talent_name: null,
        enchantment_id: null,
        enchantment_name: null,
        icon_url: null,
        users: 111,
        denominator: 148,
        unavailable: 2,
        adoption_rate: "0.75000000",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "gear-item");

    assert.ok(adoption);
    assert.equal(adoption.iconUrl, null);
    assert.equal(adoption.rate, 0.75);
    assert.match(db.calls[0]?.text ?? "", /left join item_media/);
  });

  it("solo añade el limit cuando se pide", async () => {
    const withoutLimit = fakeDb([]);
    await readAdoption(withoutLimit, segment, "gear-item");
    assert.ok(!/limit/.test(withoutLimit.calls[0]?.text ?? ""));
    assert.equal(withoutLimit.calls[0]?.values.length, 2);

    const withLimit = fakeDb([]);
    await readAdoption(withLimit, segment, "gear-item", { limit: 5 });
    assert.match(withLimit.calls[0]?.text ?? "", /limit \$3/);
    assert.deepEqual(withLimit.calls[0]?.values, [segment.rowId, "gear-item", 5]);
  });
});

describe("readAdoption con variables de talento", () => {
  const segment = toSegmentRead(row({ sample_size: 400, talent_node_sample: 100 }));

  it("trae el árbol, el id y el nombre del nodo (ADR 0026)", async () => {
    const db = fakeDb([
      {
        variable_kind: "talent-node",
          variable_key: "class:99846",
          slot_group: null,
          item_id: null,
          item_name: null,
          talent_tree: "class",
          talent_id: "99846",
          talent_name: "Shimmer",
          enchantment_id: null,
          enchantment_name: null,
          icon_url: null,
          users: 62,
          denominator: 100,
          unavailable: 340,
          adoption_rate: "0.62",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "talent-node");
    assert.equal(adoption?.talentTree, "class");
    assert.equal(adoption?.talentId, 99846);
    assert.equal(adoption?.talentName, "Shimmer");
    assert.equal(adoption?.rate, 0.62);
    // El denominador es el de la fila, no el gear_sample del escalón.
    assert.equal(adoption?.provenance.denominator, 100);
    assert.equal(adoption?.unavailable, 340);
  });

  it("un nodo sin nombre resuelto sigue siendo una adopción que enseñar", async () => {
    const db = fakeDb([
      {
        variable_kind: "talent-node",
          variable_key: "spec:1",
          slot_group: null,
          item_id: null,
          item_name: null,
          talent_tree: "spec",
          talent_id: "1",
          talent_name: null,
          enchantment_id: null,
          enchantment_name: null,
          icon_url: null,
          users: 5,
          denominator: 10,
          unavailable: 0,
          adoption_rate: "0.5",
      },
    ]);

    const [adoption] = await readAdoption(db, segment, "talent-node");
    assert.equal(adoption?.talentName, null);
    assert.equal(adoption?.rate, 0.5);
  });
});

describe("readAdoption con variables de gear", () => {
  const segment = toSegmentRead(row({ sample_size: 400, gear_sample: 150 }));

  function adoptionRow(overrides: Record<string, unknown>) {
    return {
      variable_kind: "gear-gem",
      variable_key: "gem:240914",
      slot_group: null,
      item_id: "240914",
      item_name: "Flawless Deadly Lapis",
      talent_tree: null,
      talent_id: null,
      talent_name: null,
      enchantment_id: null,
      enchantment_name: null,
      icon_url: null,
      users: 90,
      denominator: 150,
      unavailable: 0,
      adoption_rate: "0.60000000",
      ...overrides,
    };
  }

  it("la gema lleva item_id, así que puede traer icono del catálogo", async () => {
    const db = fakeDb([adoptionRow({ icon_url: "https://render.worldofwarcraft.com/x.jpg" })]);
    const [gem] = await readAdoption(db, segment, "gear-gem");

    assert.equal(gem?.itemId, 240914);
    assert.equal(gem?.itemName, "Flawless Deadly Lapis");
    assert.equal(gem?.slotGroup, null);
    assert.equal(gem?.iconUrl, "https://render.worldofwarcraft.com/x.jpg");
  });

  it("el encantamiento sale sin item_id y sin icono, y sigue siendo una adopción", async () => {
    // Lo que falta ahí es la ilustración (#92), no la cifra: §4.5 del brief
    // reserva el hueco y la fila se enseña igual.
    const db = fakeDb([
      adoptionRow({
        variable_kind: "gear-enchant",
        variable_key: "enchant:7364",
        item_id: null,
        item_name: null,
        enchantment_id: "7364",
        enchantment_name: "Enchant Ring - Silvermoon's Alacrity",
      }),
    ]);
    const [enchant] = await readAdoption(db, segment, "gear-enchant");

    assert.equal(enchant?.itemId, null);
    assert.equal(enchant?.iconUrl, null);
    assert.equal(enchant?.enchantmentId, 7364);
    assert.equal(enchant?.enchantmentName, "Enchant Ring - Silvermoon's Alacrity");
    assert.equal(enchant?.rate, 0.6);
    assert.equal(enchant?.provenance.denominator, 150);
  });
});

describe("readAdoptionFor", () => {
  const own = toSegmentRead(row({ id: "41", segment_id: "1800-2000", gear_sample: 150 }));
  const target = toSegmentRead(row({ id: "42", segment_id: "2000-2200", gear_sample: 120 }));

  function gearRow(segmentId: string, itemId: string, rate: string) {
    return {
      population_segment_id: segmentId,
      variable_kind: "gear-item",
      variable_key: `HEAD:${itemId}`,
      slot_group: "HEAD",
      item_id: itemId,
      item_name: "Yelmo",
      talent_tree: null,
      talent_id: null,
      talent_name: null,
      enchantment_id: null,
      enchantment_name: null,
      icon_url: null,
      users: 30,
      denominator: 150,
      unavailable: 0,
      adoption_rate: rate,
    };
  }

  it("trae los dos escalones en una sola consulta", async () => {
    const db = fakeDb([gearRow("41", "1", "0.20000000"), gearRow("42", "1", "0.60000000")]);
    const byRowId = await readAdoptionFor(db, [own, target], "gear-item");

    assert.equal(db.calls.length, 1);
    assert.equal(byRowId.get("41")?.[0]?.rate, 0.2);
    assert.equal(byRowId.get("42")?.[0]?.rate, 0.6);
  });

  it("cada adopción hereda la procedencia de su propio escalón", async () => {
    const db = fakeDb([gearRow("42", "1", "0.60000000")]);
    const byRowId = await readAdoptionFor(db, [own, target], "gear-item");

    assert.equal(byRowId.get("42")?.[0]?.provenance.computedAt, target.population.computedAt);
  });

  it("un escalón sin filas viene con la lista vacía, no ausente", async () => {
    // "Todavía no se ha calculado ahí" es una respuesta; un undefined lo
    // interpretaría cada llamante a su manera.
    const db = fakeDb([gearRow("42", "1", "0.60000000")]);
    const byRowId = await readAdoptionFor(db, [own, target], "gear-item");

    assert.deepEqual(byRowId.get("41"), []);
  });

  it("sin escalones no va a la base", async () => {
    const db = fakeDb([]);
    assert.equal((await readAdoptionFor(db, [], "gear-item")).size, 0);
    assert.equal(db.calls.length, 0);
  });
});
