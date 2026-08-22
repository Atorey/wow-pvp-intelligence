import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import { readAdoption, readBracketSegments, readSegment, toSegmentRead } from "./segments";
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
