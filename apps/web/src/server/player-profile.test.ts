import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM, segmentFor } from "@wowpvp/core";
import type { CharacterSnapshotRead, SegmentRead, StandingRead } from "@wowpvp/data";

import { gapFor, observedSpecs, pickSpec, standingFor } from "./player-profile";

const COMPUTED_AT = new Date("2026-09-02T04:00:00Z");

function snapshot(overrides: Partial<CharacterSnapshotRead> = {}): CharacterSnapshotRead {
  return {
    characterId: "c1",
    nameDisplay: "Ánatorey",
    realmSlug: "sanguino",
    faction: "HORDE",
    seasonId: 42,
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    rating: 1994,
    ladderRank: null,
    matchesPlayed: 118,
    matchesWon: 61,
    matchesLost: 57,
    pvpTierId: null,
    equippedItemLevel: 263,
    averageItemLevel: 265,
    talentLoadoutCode: null,
    provenance: { observedAt: COMPUTED_AT, source: "profile" },
    ...overrides,
  };
}

/** Una fila de segmento con las cuatro bases de cálculo puestas a mano. */
function segment(
  min: number,
  bases: { population: number; gear: number; itemLevel?: number; median?: number | null },
): SegmentRead {
  const ratingSegment = segmentFor(min);
  const provenance = (denominator: number) => ({
    computedAt: COMPUTED_AT,
    sampleSize: bases.population,
    denominator,
    confidence: "insufficient" as const,
  });

  return {
    rowId: `row-${min}`,
    region: "eu",
    seasonId: 42,
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    segment: ratingSegment,
    activityWindowDays: 7,
    population: provenance(bases.population),
    gear: provenance(bases.gear),
    talents: provenance(0),
    talentNodes: provenance(0),
    pvpTalents: provenance(0),
    itemLevel: provenance(bases.itemLevel ?? bases.gear),
    rating: { median: null, p25: null, p75: null, min, max: min + 199 },
    equippedItemLevelMedian: bases.median === undefined ? 246 : bases.median,
    profileData: { from: null, to: null },
    excludedSearch: 0,
    activity: { byDelta: 0, byFirstSeen: 0 },
  };
}

describe("observedSpecs", () => {
  it("ordena por rating: la spec que abre la página es la que el jugador considera suya", () => {
    const specs = observedSpecs([
      snapshot({ bracket: "shuffle-mage-fire", rating: 1500 }),
      snapshot({ bracket: "shuffle-mage-frost", rating: 1994 }),
    ]);

    assert.deepEqual(
      specs.map((entry) => entry.slug),
      ["frost-mage", "fire-mage"],
    );
  });

  it("deja fuera un bracket que el catálogo no sabe nombrar", () => {
    // Partir "2v2" por guiones no da ni clase ni spec, y adivinarlas es lo que
    // prohíbe el ADR 0016. Se cae de la lista entera, no se pinta a medias.
    const specs = observedSpecs([snapshot({ bracket: "2v2" }), snapshot()]);

    assert.deepEqual(
      specs.map((entry) => entry.bracket),
      ["shuffle-mage-frost"],
    );
  });
});

describe("pickSpec", () => {
  const specs = observedSpecs([
    snapshot({ bracket: "shuffle-mage-fire", rating: 1500 }),
    snapshot({ bracket: "shuffle-mage-frost", rating: 1994 }),
  ]);

  it("sin nada pedido abre en la de mayor rating", () => {
    assert.equal(pickSpec(specs)?.slug, "frost-mage");
  });

  it("lo pedido en la URL manda sobre el defecto", () => {
    assert.equal(pickSpec(specs, "fire-mage")?.slug, "fire-mage");
  });

  it("una spec que este personaje no juega cae en la de por defecto, no en un 404", () => {
    // La ruta identifica al personaje; la spec es una vista suya. Un 404 diría
    // que el personaje no existe, que es otra cosa y además falsa.
    assert.equal(pickSpec(specs, "arms-warrior")?.slug, "frost-mage");
  });

  it("sin ninguna spec observada no hay nada que abrir", () => {
    assert.equal(pickSpec([]), null);
  });
});

describe("gapFor", () => {
  it("en el tramo abierto de arriba no hay escalón que comparar", () => {
    const gap = gapFor({ rating: 3100, playerItemLevel: 263, target: null });

    // No es falta de muestra, así que no puede contarse como tal (§1.6).
    assert.equal(gap.state, "top-segment");
  });

  it("sin gente arriba, la causa es la población y no nuestro muestreo", () => {
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 12, gear: 0 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "population");
  });

  it("con gente arriba y sin su equipo, la causa es nuestra", () => {
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 287, gear: 4 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "sampling");
    // La cifra que se enseña es la cruda, con su denominador: "4 de 287".
    assert.equal(gap.state === "insufficient" && gap.population, 287);
    assert.equal(gap.state === "insufficient" && gap.gearSample, 4);
  });

  it("un segmento sin fila calculada no se cuenta como poblado", () => {
    const gap = gapFor({ rating: 1994, playerItemLevel: 263, target: null });

    assert.equal(gap.state === "insufficient" && gap.population, 0);
    assert.equal(gap.state === "insufficient" && gap.cause, "population");
  });

  it("decide con gear_sample y nunca con la población del segmento", () => {
    // El caso de #76: población de sobra y cero perfiles con equipo. Si la caja
    // mirase `sample_size` diría que hay comparación donde no hay nada.
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 3000, gear: MIN_SAMPLE_MEDIUM - 1 }),
    });

    assert.equal(gap.state, "insufficient");
  });

  it("sin perfil de quien mira no hay comparación, y la causa lo dice", () => {
    // Aparecer en el leaderboard trae rating y nada más. Decirle a esa persona
    // que nos falta muestrear el segmento de arriba señalaría el lado
    // equivocado: el que falta es el suyo.
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: null,
      target: segment(2000, { population: 300, gear: 312 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "subject");
  });

  it("con muestra suficiente la confianza sale del denominador", () => {
    const medium = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 300, gear: MIN_SAMPLE_MEDIUM }),
    });
    const high = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 300, gear: MIN_SAMPLE_HIGH }),
    });

    assert.equal(medium.state === "comparable" && medium.confidence, "medium");
    assert.equal(high.state === "comparable" && high.confidence, "high");
  });

  it("la cifra de item level lleva su propio denominador, no el de la caja", () => {
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 300, gear: 312, itemLevel: 305, median: 246 }),
    });

    assert.deepEqual(gap.state === "comparable" && gap.itemLevel, {
      player: 263,
      median: 246,
      denominator: 305,
    });
  });

  it("una mediana sin base suficiente no se enseña, aunque la caja sí compare", () => {
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: 263,
      target: segment(2000, { population: 300, gear: 312, itemLevel: 4, median: 246 }),
    });

    assert.equal(gap.state === "comparable" && gap.itemLevel, null);
  });

  it("sin item level del jugador no queda ninguna comparación en pie", () => {
    // null es "no disponible" (regla 5): no se sustituye por la mediana ni por
    // un cero, que se leería como un personaje desnudo. Y sin esa cifra la caja
    // no tiene nada que comparar, así que no se queda en `comparable` vacía.
    const gap = gapFor({
      rating: 1994,
      playerItemLevel: null,
      target: segment(2000, { population: 300, gear: 312 }),
    });

    assert.notEqual(gap.state, "comparable");
  });
});

describe("standingFor", () => {
  const standing: StandingRead = { observed: 4412, below: 3187, percentile: 72.2, highest: 3306 };

  it("empareja los segmentos por su id, no por su posición en la lista", () => {
    const view = standingFor({
      rating: 1994,
      standing,
      segments: [
        segment(1600, { population: 100, gear: 0 }),
        segment(1800, { population: 812, gear: 305 }),
        segment(2000, { population: 641, gear: 312 }),
      ],
    });

    assert.equal(view.ownSegment.id, "1800-2000");
    assert.equal(view.ownPopulation, 812);
    assert.equal(view.targetPopulation, 641);
  });

  it("declara con qué ventana se contaron esas poblaciones", () => {
    // El percentil cuenta la temporada entera y los segmentos solo a quien
    // estuvo activo: sin decirlo, las cifras se leerían como partes del mismo
    // total y no suman.
    const view = standingFor({
      rating: 1994,
      standing,
      segments: [segment(1800, { population: 812, gear: 0 })],
    });

    assert.equal(view.activityWindowDays, 7);
  });

  it("sin ninguna fila de segmento, las poblaciones son null y no cero", () => {
    // Cero diría "no hay nadie ahí"; null dice "no se ha calculado", que es lo
    // que de verdad sabemos (regla 5 del proyecto).
    const view = standingFor({ rating: 1994, standing, segments: [] });

    assert.equal(view.ownPopulation, null);
    assert.equal(view.targetPopulation, null);
    assert.equal(view.activityWindowDays, null);
  });
});
