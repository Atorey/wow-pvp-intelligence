import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { segmentFor } from "@wowpvp/core";
import type { GapView } from "../server/player-profile";

import { gapOutcome, gapViewEventData, parseGapViewEvent } from "./gap-view";

const OWN = segmentFor(1994);
const TARGET = segmentFor(2100);
const TOP = segmentFor(3200);

const SUBJECT = { spec: "frost-mage", bracket: "solo-shuffle", locale: "es" } as const;

const VISITOR = "3f1c2b4a-5d6e-4f80-91a2-b3c4d5e6f708";

/** La corrida de la que salen las cifras. Al desenlace no le afecta; al tipo sí. */
const COMPUTED_AT = new Date("2026-09-08T05:30:00.000Z");

function comparable(confidence: "high" | "medium"): GapView {
  return {
    state: "comparable",
    ownSegment: OWN,
    targetSegment: TARGET,
    computedAt: COMPUTED_AT,
    confidence,
    gearSample: confidence === "high" ? 120 : 40,
    itemLevel: null,
    overlap: null,
    gear: { state: "insufficient", missing: "target", sample: 0, needed: 30 },
    talents: { state: "insufficient", missing: "target", sample: 0, needed: 30 },
  };
}

describe("el desenlace de la caja", () => {
  it("desdobla la confianza, que es lo que la caja no distingue y la métrica sí", () => {
    assert.equal(gapOutcome(comparable("high")), "high");
    assert.equal(gapOutcome(comparable("medium")), "medium");
  });

  it("cuenta también los dos estados sin comparación", () => {
    // Son el denominador de la North Star y, el primero, la métrica de salud
    // del dato entera: dejarlos fuera haría que el cociente subiera solo.
    const insufficient: GapView = {
      state: "insufficient",
      ownSegment: OWN,
      targetSegment: TARGET,
      computedAt: COMPUTED_AT,
      cause: "population",
      population: 4,
      gearSample: 0,
      needed: 30,
    };
    assert.equal(gapOutcome(insufficient), "insufficient");
    assert.equal(gapOutcome({ state: "top-segment", ownSegment: TOP }), "top-segment");
  });
});

describe("los datos del evento", () => {
  it("escribe el segmento como lo escribe la URL", () => {
    const data = gapViewEventData(comparable("high"), SUBJECT);
    assert.equal(data.segment, "2000-2200");
    assert.equal(data.spec, "frost-mage");
    assert.equal(data.locale, "es");
  });

  it("deja el segmento en null cuando no hay escalón encima", () => {
    // No es un dato que falte: es que arriba del tramo abierto no hay objetivo.
    const data = gapViewEventData({ state: "top-segment", ownSegment: TOP }, SUBJECT);
    assert.equal(data.segment, null);
    assert.equal(data.outcome, "top-segment");
  });

  it("el tramo abierto viaja como 3000-plus, ni con + ni con Infinity", () => {
    const gap: GapView = {
      state: "insufficient",
      ownSegment: segmentFor(2900),
      targetSegment: TOP,
      computedAt: COMPUTED_AT,
      cause: "population",
      population: 2,
      gearSample: 0,
      needed: 30,
    };
    assert.equal(gapViewEventData(gap, SUBJECT).segment, "3000-plus");
  });
});

describe("lo que entra por el endpoint", () => {
  const valid = {
    visitorId: VISITOR,
    outcome: "high",
    spec: "frost-mage",
    bracket: "solo-shuffle",
    segment: "2000-2200",
    locale: "en",
  };

  it("acepta un evento bien formado", () => {
    assert.deepEqual(parseGapViewEvent(valid), valid);
  });

  it("acepta el segmento nulo del tramo abierto", () => {
    const event = { ...valid, outcome: "top-segment", segment: null };
    assert.deepEqual(parseGapViewEvent(event), event);
  });

  it("rechaza lo que no está en ningún catálogo", () => {
    // Una spec, una modalidad o un segmento inventados no son datos con los que
    // no contábamos: son filas que ensucian el denominador para siempre.
    assert.equal(parseGapViewEvent({ ...valid, spec: "fireball-mage" }), null);
    assert.equal(parseGapViewEvent({ ...valid, bracket: "3v3" }), null);
    assert.equal(parseGapViewEvent({ ...valid, segment: "2010-2190" }), null);
    assert.equal(parseGapViewEvent({ ...valid, outcome: "low" }), null);
    assert.equal(parseGapViewEvent({ ...valid, locale: "fr" }), null);
  });

  it("rechaza un identificador que no tiene la forma que generamos", () => {
    assert.equal(parseGapViewEvent({ ...valid, visitorId: "anatorey" }), null);
    assert.equal(parseGapViewEvent({ ...valid, visitorId: "" }), null);
  });

  it("rechaza lo que ni siquiera es un objeto", () => {
    assert.equal(parseGapViewEvent(null), null);
    assert.equal(parseGapViewEvent("high"), null);
    assert.equal(parseGapViewEvent([valid]), null);
  });
});
