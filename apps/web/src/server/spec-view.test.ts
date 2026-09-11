import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_SAMPLE_MEDIUM, segmentFor } from "@wowpvp/core";
import {
  provenanceFor,
  type AdoptionRead,
  type RunPopulationRead,
  type SegmentRead,
  type VariableKind,
} from "@wowpvp/data";

import { medianSegment, segmentDetailFor, specOverviewFor } from "./spec-view";

const COMPUTED_AT = new Date("2026-09-10T04:00:00Z");

/**
 * Una fila de escalón con sus bases puestas a mano. Las procedencias se
 * construyen con `provenanceFor`, así que la confianza sale de cada
 * denominador igual que en producción.
 */
function segment(
  min: number,
  bases: {
    population: number;
    gear?: number;
    nodes?: number;
    pvp?: number;
    itemLevel?: number;
    window?: 7 | 14;
    max?: number | null;
    computedAt?: Date;
  },
): SegmentRead {
  const base = (denominator: number) =>
    provenanceFor({
      computedAt: bases.computedAt ?? COMPUTED_AT,
      sampleSize: bases.population,
      denominator,
    });

  return {
    rowId: `row-${min}`,
    region: "eu",
    seasonId: 42,
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    segment: segmentFor(min),
    activityWindowDays: bases.window ?? 7,
    population: base(bases.population),
    gear: base(bases.gear ?? 0),
    talents: base(0),
    talentNodes: base(bases.nodes ?? 0),
    pvpTalents: base(bases.pvp ?? 0),
    itemLevel: base(bases.itemLevel ?? bases.gear ?? 0),
    rating: {
      median: null,
      p25: null,
      p75: null,
      min,
      max: bases.max === undefined ? min + 199 : bases.max,
    },
    equippedItemLevelMedian: 246,
    profileData: { from: null, to: null },
    excludedSearch: 0,
    activity: { byDelta: 0, byFirstSeen: 0 },
  };
}

function adoption(
  kind: VariableKind,
  key: string,
  rate: number,
  overrides: Partial<AdoptionRead> = {},
): AdoptionRead {
  return {
    kind,
    variableKey: key,
    slotGroup: null,
    itemId: null,
    itemName: null,
    talentTree: null,
    talentId: null,
    talentName: null,
    enchantmentId: null,
    enchantmentName: null,
    iconUrl: null,
    users: Math.round(rate * 100),
    unavailable: 0,
    rate,
    provenance: provenanceFor({ computedAt: COMPUTED_AT, sampleSize: 300, denominator: 100 }),
    ...overrides,
  };
}

const noAdoptions = { gear: [], talentNodes: [], heroTrees: [], pvpTalents: [] };

/** Los recuentos del mockup de Frost Mage, que es donde se dibujó la tabla. */
const FROST = [
  segment(1200, { population: 506, gear: 12 }),
  segment(1400, { population: 711, gear: 96 }),
  segment(1600, { population: 1004, gear: 288 }),
  segment(1800, { population: 812, gear: 305 }),
  segment(2000, { population: 641, gear: 312 }),
  segment(2200, { population: 402, gear: 254 }),
  segment(2400, { population: 188, gear: 112 }),
  segment(2600, { population: 96, gear: 41, window: 14 }),
  segment(2800, { population: 34, gear: 0, window: 14 }),
  segment(3000, { population: 18, gear: 0, window: 14, max: 3306 }),
];

describe("specOverviewFor", () => {
  it("el total es la suma de la tabla, de una sola población", () => {
    const overview = specOverviewFor({ bracket: "shuffle-mage-frost", segments: FROST, run: null });

    assert.equal(overview?.observed, 4412);
    const rowsTotal = overview?.rows.reduce((sum, row) => sum + row.population, 0);
    assert.equal(rowsTotal, overview?.observed);
  });

  it("lista de arriba abajo y deja fuera los tramos sin nadie", () => {
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: [
        segment(1400, { population: 711 }),
        segment(1600, { population: 1004 }),
        segment(1800, { population: 0 }),
      ],
      run: null,
    });

    assert.deepEqual(
      overview?.rows.map((row) => row.segment.id),
      ["1600-1800", "1400-1600"],
    );
  });

  it("la confianza de cada fila sale de su gear, nunca de su población", () => {
    // 3.000 personas y cero perfiles: la fila que la columna `confidence`
    // guardaba como `high`.
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: [
        segment(1600, { population: 3000, gear: 0 }),
        segment(1800, { population: 120, gear: 41 }),
        segment(2000, { population: 400, gear: 312 }),
      ],
      run: null,
    });

    assert.deepEqual(
      overview?.rows.map((row) => [row.segment.id, row.population, row.gearSample, row.confidence]),
      [
        ["2000-2200", 400, 312, "high"],
        ["1800-2000", 120, 41, "medium"],
        ["1600-1800", 3000, 0, "insufficient"],
      ],
    );
  });

  it("el peso de cada tramo es sobre el total de la spec, y cada fila lleva su ventana", () => {
    const overview = specOverviewFor({ bracket: "shuffle-mage-frost", segments: FROST, run: null });
    const top = overview?.rows[0];

    assert.equal(top?.share, 18 / 4412);
    assert.equal(top?.activityWindowDays, 14);
    const shares = overview?.rows.reduce((sum, row) => sum + row.share, 0) ?? 0;
    assert.ok(Math.abs(shares - 1) < 1e-9);
  });

  it("el rating más alto es el máximo de los tramos", () => {
    const overview = specOverviewFor({ bracket: "shuffle-mage-frost", segments: FROST, run: null });
    assert.equal(overview?.highestRating, 3306);
  });

  it("sin nadie observado no hay resumen que dar", () => {
    const empty = { bracket: "shuffle-mage-frost", run: null };
    assert.equal(specOverviewFor({ ...empty, segments: [] }), null);
    assert.equal(specOverviewFor({ ...empty, segments: [segment(1400, { population: 0 })] }), null);
  });
});

describe("medianSegment", () => {
  it("es el tramo donde cae el personaje del medio", () => {
    // 506 + 711 = 1.217 por debajo de 1600; con los 1.004 de 1600-1800 se
    // pasa de la mitad de 4.412.
    assert.equal(medianSegment(FROST)?.id, "1600-1800");
  });

  it("con un total par se queda con la mediana baja", () => {
    const segments = [segment(1400, { population: 1 }), segment(1600, { population: 1 })];
    assert.equal(medianSegment(segments)?.id, "1400-1600");
  });

  it("sin población no hay mediana", () => {
    assert.equal(medianSegment([segment(1400, { population: 0 })]), null);
  });
});

describe("el puesto de la spec en la modalidad", () => {
  function run(overrides: Partial<RunPopulationRead> = {}): RunPopulationRead {
    return {
      seasonId: 42,
      computedAt: COMPUTED_AT,
      brackets: [
        { bracket: "shuffle-priest-holy", population: 5000 },
        { bracket: "shuffle-mage-frost", population: 4412 },
        { bracket: "shuffle-warrior-arms", population: 1286 },
      ],
      ...overrides,
    };
  }

  it("sale de la misma corrida que los tramos", () => {
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: FROST,
      run: run(),
    });

    assert.deepEqual(overview?.standing, {
      rank: 2,
      of: 3,
      population: 4412,
      total: 5000 + 4412 + 1286,
      share: 4412 / (5000 + 4412 + 1286),
    });
  });

  it("un bracket que no es una spec no cuenta ni en el puesto ni en el total", () => {
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: FROST,
      run: run({
        brackets: [
          { bracket: "shuffle-overall", population: 99999 },
          { bracket: "shuffle-mage-frost", population: 4412 },
        ],
      }),
    });

    assert.equal(overview?.standing?.rank, 1);
    assert.equal(overview?.standing?.of, 1);
  });

  it("si los tramos son de otra corrida, se calla en vez de mezclar dos fechas", () => {
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: FROST,
      run: run({ computedAt: new Date("2026-09-11T04:00:00Z") }),
    });

    assert.equal(overview?.standing, null);
    // El resto del resumen no depende de esa corrida y sigue saliendo.
    assert.equal(overview?.observed, 4412);
  });

  it("si la corrida no trae la spec, no hay puesto", () => {
    const overview = specOverviewFor({
      bracket: "shuffle-mage-frost",
      segments: FROST,
      run: run({ brackets: [{ bracket: "shuffle-priest-holy", population: 5000 }] }),
    });

    assert.equal(overview?.standing, null);
  });
});

describe("segmentDetailFor", () => {
  it("sin base de gear no hay lista, se dice cuánto hay y cuánto falta", () => {
    const detail = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 12 }),
      adoptions: noAdoptions,
    });

    assert.deepEqual(detail.gear, {
      state: "insufficient",
      sample: 12,
      needed: MIN_SAMPLE_MEDIUM,
      cause: "sampling",
    });
  });

  it("con poca gente en el tramo, lo que falta es población y no muestreo", () => {
    const detail = segmentDetailFor({
      segment: segment(2800, { population: 12, gear: 12 }),
      adoptions: noAdoptions,
    });

    assert.equal(detail.gear.state === "insufficient" && detail.gear.cause, "population");
  });

  it("agrupa los items por hueco, en el orden de la ficha, y junta los dos abalorios", () => {
    const detail = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 312 }),
      adoptions: {
        ...noAdoptions,
        gear: [
          adoption("gear-item", "TRINKET:5", 0.47, { slotGroup: "TRINKET" }),
          // Una fila que llegara con el slot crudo cae en su grupo.
          adoption("gear-item", "TRINKET:6", 0.29, { slotGroup: "TRINKET_2" }),
          adoption("gear-item", "HEAD:2", 0.18, { slotGroup: "HEAD" }),
          adoption("gear-item", "HEAD:1", 0.61, { slotGroup: "HEAD" }),
          adoption("gear-item", "TABARD:9", 0.9, { slotGroup: "TABARD" }),
        ],
      },
    });

    assert.equal(detail.gear.state, "listed");
    if (detail.gear.state !== "listed") return;
    assert.equal(detail.gear.confidence, "high");
    assert.deepEqual(
      detail.gear.content.slots.map((slot) => [
        slot.group,
        slot.paired,
        slot.rows.map((row) => row.variableKey),
      ]),
      [
        ["HEAD", false, ["HEAD:1", "HEAD:2"]],
        ["TRINKET", true, ["TRINKET:5", "TRINKET:6"]],
      ],
    );
  });

  it("gemas y encantamientos van aparte de los huecos, de más a menos llevados", () => {
    const detail = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 45 }),
      adoptions: {
        ...noAdoptions,
        gear: [
          adoption("gear-gem", "gem:1", 0.2),
          adoption("gear-gem", "gem:2", 0.6),
          adoption("gear-enchant", "enchant:7", 0.5),
        ],
      },
    });

    assert.equal(detail.gear.state, "listed");
    if (detail.gear.state !== "listed") return;
    assert.equal(detail.gear.confidence, "medium");
    assert.deepEqual(
      detail.gear.content.gems.map((row) => row.variableKey),
      ["gem:2", "gem:1"],
    );
    assert.deepEqual(
      detail.gear.content.enchants.map((row) => row.variableKey),
      ["enchant:7"],
    );
    assert.deepEqual(detail.gear.content.slots, []);
  });

  it("cada familia se decide con su propia base, no con la del gear", () => {
    // Gear de sobra, nodos recién empezados y PvP justo: el estado real de los
    // primeros días tras la migración 0012.
    const detail = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 312, nodes: 12, pvp: 45 }),
      adoptions: {
        ...noAdoptions,
        pvpTalents: [adoption("pvp-talent", "pvp:1", 0.7, { talentTree: "pvp" })],
      },
    });

    assert.equal(detail.gear.state, "listed");
    assert.deepEqual(detail.build, {
      state: "insufficient",
      sample: 12,
      needed: MIN_SAMPLE_MEDIUM,
      cause: "sampling",
    });
    assert.equal(detail.pvp.state, "listed");
    if (detail.pvp.state !== "listed") return;
    assert.equal(detail.pvp.confidence, "medium");
  });

  it("los nodos salen por árbol, en el orden de la ventana de talentos", () => {
    const detail = segmentDetailFor({
      segment: segment(2000, { population: 641, nodes: 150 }),
      adoptions: {
        ...noAdoptions,
        talentNodes: [
          adoption("talent-node", "hero:3", 0.9, { talentTree: "hero" }),
          adoption("talent-node", "class:1", 0.4, { talentTree: "class", unavailable: 20 }),
          adoption("talent-node", "class:2", 0.8, { talentTree: "class", unavailable: 20 }),
        ],
        heroTrees: [adoption("hero-tree", "39", 0.71), adoption("hero-tree", "40", 0.29)],
      },
    });

    assert.equal(detail.build.state, "listed");
    if (detail.build.state !== "listed") return;
    assert.deepEqual(
      detail.build.content.trees.map((view) => [
        view.tree,
        view.rows.map((row) => row.variableKey),
      ]),
      [
        ["class", ["class:2", "class:1"]],
        ["hero", ["hero:3"]],
      ],
    );
    assert.deepEqual(
      detail.build.content.heroTrees.map((row) => row.variableKey),
      ["39", "40"],
    );
  });

  it("la mediana de item level solo sale con su propia base", () => {
    const withBase = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 312, itemLevel: 300 }),
      adoptions: noAdoptions,
    });
    const withoutBase = segmentDetailFor({
      segment: segment(2000, { population: 641, gear: 312, itemLevel: 12 }),
      adoptions: noAdoptions,
    });

    assert.deepEqual(withBase.itemLevel, { median: 246, sample: 300 });
    assert.equal(withoutBase.itemLevel, null);
  });
});
