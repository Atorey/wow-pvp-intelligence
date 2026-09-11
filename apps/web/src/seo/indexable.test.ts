import { provenanceFor, type SegmentSampleRead } from "@wowpvp/data";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  SPEC_PAGES_PUBLISHED,
  indexableSpecRoutes,
  isSegmentIndexable,
  isSpecPathIndexable,
  robotsFor,
  specRoutesWithSample,
} from "./indexable";

const COMPUTED_AT = new Date("2026-09-06T03:00:00Z");

/** Un escalón poblado del que no sabemos nada: el caso mayoritario hoy. */
function sample(overrides: Partial<Record<"gear" | "talentNodes" | "pvpTalents", number>> = {}) {
  const base = { computedAt: COMPUTED_AT, sampleSize: 3000 };
  const read: SegmentSampleRead = {
    bracket: "shuffle-mage-frost",
    segmentId: "2000-2200",
    gear: provenanceFor({ ...base, denominator: overrides.gear ?? 0 }),
    talentNodes: provenanceFor({ ...base, denominator: overrides.talentNodes ?? 0 }),
    pvpTalents: provenanceFor({ ...base, denominator: overrides.pvpTalents ?? 0 }),
  };
  return read;
}

/** La misma muestra, calculada en otra corrida más vieja. */
function staleAt(read: SegmentSampleRead, computedAt: Date): SegmentSampleRead {
  return {
    ...read,
    segmentId: "2000-2200",
    gear: { ...read.gear, computedAt },
    talentNodes: { ...read.talentNodes, computedAt },
    pvpTalents: { ...read.pvpTalents, computedAt },
  };
}

describe("isSegmentIndexable", () => {
  it("basta con que una de las tres bases llegue al umbral", () => {
    assert.equal(isSegmentIndexable(sample({ gear: 30 })), true);
    assert.equal(isSegmentIndexable(sample({ talentNodes: 46 })), true);
    assert.equal(isSegmentIndexable(sample({ pvpTalents: 120 })), true);
  });

  it("la población no indexa nada por sí sola", () => {
    // 3.000 personas y cero perfiles: la fila que #76 guardaba como `high`.
    assert.equal(isSegmentIndexable(sample()), false);
  });

  it("por debajo del umbral no se indexa aunque falte poco", () => {
    assert.equal(isSegmentIndexable(sample({ gear: 29, talentNodes: 29 })), false);
  });
});

describe("specRoutesWithSample", () => {
  it("un escalón servible publica sus tres niveles", () => {
    const routes = specRoutesWithSample([sample({ gear: 120 })]);

    assert.deepEqual(
      routes.map((route) => route.path),
      [
        "/spec/frost-mage",
        "/spec/frost-mage/solo-shuffle",
        "/spec/frost-mage/solo-shuffle/2000-2200",
      ],
    );
    assert.deepEqual(routes[0]?.lastModified, COMPUTED_AT);
  });

  it("el escalón sin muestra no publica nada, ni siquiera su spec", () => {
    assert.deepEqual(specRoutesWithSample([sample(), { ...sample(), segmentId: "1800-2000" }]), []);
  });

  it("los niveles de arriba se publican una vez y con la fecha más reciente", () => {
    const older = new Date("2026-09-01T03:00:00Z");
    const routes = specRoutesWithSample([
      { ...sample({ gear: 120 }), segmentId: "1800-2000" },
      staleAt(sample({ gear: 120 }), older),
    ]);

    // Dos escalones de la misma spec: cuatro URL, no seis.
    assert.equal(routes.length, 4);
    assert.deepEqual(
      routes.find((route) => route.path === "/spec/frost-mage")?.lastModified,
      COMPUTED_AT,
    );
  });

  it("un bracket que no está en el catálogo no inventa página", () => {
    // El agregado de Solo Shuffle aparece en el índice de Blizzard junto a los
    // brackets por spec y no es una spec.
    const rogue = { ...sample({ gear: 120 }), bracket: "shuffle" };
    assert.deepEqual(specRoutesWithSample([rogue]), []);
  });

  it("un segmento que la escala no genera tampoco", () => {
    const invented = { ...sample({ gear: 120 }), segmentId: "2010-2190" };
    assert.deepEqual(specRoutesWithSample([invented]), []);
  });
});

describe("indexableSpecRoutes", () => {
  it("con las páginas de spec encendidas, publica lo que respalda la muestra", () => {
    assert.equal(SPEC_PAGES_PUBLISHED, true);
    assert.deepEqual(
      indexableSpecRoutes([sample({ gear: 120 })]),
      specRoutesWithSample([sample({ gear: 120 })]),
    );
  });
});

describe("isSpecPathIndexable", () => {
  it("una ruta se indexa si está en lo que publica el sitemap, por la base que sea", () => {
    const samples = [sample({ talentNodes: 46 })];

    assert.equal(isSpecPathIndexable("/spec/frost-mage", samples), true);
    assert.equal(isSpecPathIndexable("/spec/frost-mage/solo-shuffle", samples), true);
    assert.equal(isSpecPathIndexable("/spec/frost-mage/solo-shuffle/2000-2200", samples), true);
  });

  it("un tramo sin muestra no se indexa aunque su spec sí", () => {
    const samples = [sample({ gear: 120 })];

    assert.equal(isSpecPathIndexable("/spec/frost-mage/solo-shuffle/1800-2000", samples), false);
    assert.equal(isSpecPathIndexable("/spec/fire-mage", samples), false);
  });
});

describe("robotsFor", () => {
  const production = { CONTEXT: "production" };

  it("una página indexable en producción se indexa", () => {
    assert.deepEqual(robotsFor(true, production), { index: true, follow: true });
  });

  it("una página indexable fuera de producción sigue sin indexarse", () => {
    // El `robots` de una página pisa el del layout: sin este producto, cada
    // preview de Netlify publicaría el sitio entero (ADR 0029, decisión 7).
    assert.deepEqual(robotsFor(true, { CONTEXT: "deploy-preview" }), {
      index: false,
      follow: false,
    });
    assert.deepEqual(robotsFor(true, {}), { index: false, follow: false });
  });

  it("una página no indexable no se indexa ni en producción", () => {
    assert.deepEqual(robotsFor(false, production), { index: false, follow: false });
  });
});
