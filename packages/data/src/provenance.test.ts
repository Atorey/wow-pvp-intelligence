import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM } from "@wowpvp/core";
import { isComparable, provenanceFor } from "./provenance";

const COMPUTED_AT = new Date("2026-08-20T03:00:00Z");

describe("provenanceFor", () => {
  it("deriva la confianza del denominador, no de la población", () => {
    // El caso real de #76: mucha gente en el escalón y ningún perfil con gear.
    const provenance = provenanceFor({
      computedAt: COMPUTED_AT,
      sampleSize: 3000,
      denominator: 0,
    });

    assert.equal(provenance.confidence, "insufficient");
    assert.equal(provenance.sampleSize, 3000);
    assert.equal(provenance.denominator, 0);
  });

  it("usa los umbrales de packages/core, sin copiarlos", () => {
    const at = (denominator: number) =>
      provenanceFor({ computedAt: COMPUTED_AT, sampleSize: 999, denominator }).confidence;

    assert.equal(at(MIN_SAMPLE_HIGH), "high");
    assert.equal(at(MIN_SAMPLE_HIGH - 1), "medium");
    assert.equal(at(MIN_SAMPLE_MEDIUM), "medium");
    assert.equal(at(MIN_SAMPLE_MEDIUM - 1), "insufficient");
  });

  it("conserva el computed_at de la corrida que produjo la cifra", () => {
    const provenance = provenanceFor({
      computedAt: COMPUTED_AT,
      sampleSize: 120,
      denominator: 120,
    });

    assert.equal(provenance.computedAt, COMPUTED_AT);
  });
});

describe("isComparable", () => {
  it("mira el denominador y no la población del escalón", () => {
    const populated = provenanceFor({
      computedAt: COMPUTED_AT,
      sampleSize: 3000,
      denominator: 12,
    });
    assert.equal(isComparable(populated), false);

    const measured = provenanceFor({
      computedAt: COMPUTED_AT,
      sampleSize: 40,
      denominator: 40,
    });
    assert.equal(isComparable(measured), true);
  });
});
