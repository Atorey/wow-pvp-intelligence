import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM, segmentFor } from "@wowpvp/core";
import type {
  AdoptionRead,
  CharacterGearRead,
  CharacterTalentsRead,
  SegmentRead,
  StandingRead,
  CharacterSnapshotRead,
} from "@wowpvp/data";

import {
  gapFor,
  gearKeys,
  listFor,
  observedSpecs,
  pickSpec,
  standingFor,
  talentKeys,
  type PlayerSide,
} from "./player-profile";

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

/** Ningún agregado leído: el estado de la caja no depende de ellos. */
const NO_ADOPTIONS = {
  gear: { own: [], target: [] },
  talentNodes: { own: [], target: [] },
} as const;

/**
 * Lo observado de quien mira, reducido a lo que decide el estado de la caja.
 *
 * El equipo y los nodos van a `null` salvo que un caso los necesite: lo que
 * `gapFor` mira de ellos es la lista, y las listas tienen sus propios tests.
 */
function player(itemLevel: number | null): PlayerSide {
  return { itemLevel, gear: null, talents: null };
}

/** Una adopción leída, con el denominador puesto a mano, que es lo que decide. */
function adoption(
  key: string,
  rate: number,
  denominator: number,
  overrides: Partial<AdoptionRead> = {},
): AdoptionRead {
  return {
    kind: "gear-item",
    variableKey: key,
    slotGroup: key.split(":")[0] ?? null,
    itemId: Number(key.split(":")[1] ?? 0),
    itemName: null,
    talentTree: null,
    talentId: null,
    talentName: null,
    enchantmentId: null,
    enchantmentName: null,
    iconUrl: null,
    users: Math.round(rate * denominator),
    unavailable: 0,
    rate,
    provenance: {
      computedAt: COMPUTED_AT,
      sampleSize: denominator * 3,
      denominator,
      confidence: "high",
    },
    ...overrides,
  };
}

describe("gapFor", () => {
  it("en el tramo abierto de arriba no hay escalón que comparar", () => {
    const gap = gapFor({
      rating: 3100,
      player: player(263),
      target: null,
      adoptions: NO_ADOPTIONS,
    });

    // No es falta de muestra, así que no puede contarse como tal (§1.6).
    assert.equal(gap.state, "top-segment");
  });

  it("sin gente arriba, la causa es la población y no nuestro muestreo", () => {
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 12, gear: 0 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "population");
  });

  it("con gente arriba y sin su equipo, la causa es nuestra", () => {
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 287, gear: 4 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "sampling");
    // La cifra que se enseña es la cruda, con su denominador: "4 de 287".
    assert.equal(gap.state === "insufficient" && gap.population, 287);
    assert.equal(gap.state === "insufficient" && gap.gearSample, 4);
  });

  it("un segmento sin fila calculada no se cuenta como poblado", () => {
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      target: null,
      adoptions: NO_ADOPTIONS,
    });

    assert.equal(gap.state === "insufficient" && gap.population, 0);
    assert.equal(gap.state === "insufficient" && gap.cause, "population");
  });

  it("decide con gear_sample y nunca con la población del segmento", () => {
    // El caso de #76: población de sobra y cero perfiles con equipo. Si la caja
    // mirase `sample_size` diría que hay comparación donde no hay nada.
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
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
      player: player(null),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 300, gear: 312 }),
    });

    assert.equal(gap.state, "insufficient");
    assert.equal(gap.state === "insufficient" && gap.cause, "subject");
  });

  it("con muestra suficiente la confianza sale del denominador", () => {
    const medium = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 300, gear: MIN_SAMPLE_MEDIUM }),
    });
    const high = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 300, gear: MIN_SAMPLE_HIGH }),
    });

    assert.equal(medium.state === "comparable" && medium.confidence, "medium");
    assert.equal(high.state === "comparable" && high.confidence, "high");
  });

  it("la cifra de item level lleva su propio denominador, no el de la caja", () => {
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      adoptions: NO_ADOPTIONS,
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
      player: player(263),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 300, gear: 312, itemLevel: 4, median: 246 }),
    });

    assert.equal(gap.state === "comparable" && gap.itemLevel, null);
  });

  it("el solapamiento sale de las adopciones de arriba y de su equipo", () => {
    // La cifra de contexto de §1.3: la media de la adopción que tienen sus
    // items ahí arriba. Aquí lleva uno que lleva el 60% y otro que no lleva
    // nadie, así que la media es 30% sobre dos items.
    const gap = gapFor({
      rating: 1994,
      player: {
        itemLevel: 263,
        gear: {
          items: [
            {
              slot: "WAIST",
              itemId: 1,
              itemName: null,
              itemLevel: null,
              quality: null,
              iconUrl: null,
              gemItemIds: [],
              enchantmentIds: [],
            },
            {
              slot: "HEAD",
              itemId: 9,
              itemName: null,
              itemLevel: null,
              quality: null,
              iconUrl: null,
              gemItemIds: [],
              enchantmentIds: [],
            },
          ],
          equippedItemLevel: 263,
          provenance: { observedAt: COMPUTED_AT, source: "profile" },
        },
        talents: null,
      },
      target: segment(2000, { population: 300, gear: 312 }),
      adoptions: {
        gear: {
          own: [adoption("WAIST:1", 0.2, 305)],
          target: [adoption("WAIST:1", 0.6, 312), adoption("HEAD:3", 0.5, 312)],
        },
        talentNodes: { own: [], target: [] },
      },
    });

    assert.deepEqual(gap.state === "comparable" && gap.overlap, { score: 0.3, comparedItems: 2 });
  });

  it("las dos listas se deciden por separado, cada una con su denominador", () => {
    // El caso de los primeros días de la migración 0012: gear muestreado y
    // nodos a cero. Una sola confianza para las dos presentaría la más floja
    // con el aval de la más sólida.
    const gap = gapFor({
      rating: 1994,
      player: player(263),
      target: segment(2000, { population: 300, gear: 312 }),
      adoptions: {
        gear: {
          own: [adoption("WAIST:1", 0.2, 305)],
          target: [adoption("WAIST:1", 0.6, 312)],
        },
        talentNodes: { own: [], target: [] },
      },
    });

    assert.equal(gap.state === "comparable" && gap.gear.state, "listed");
    assert.equal(gap.state === "comparable" && gap.talents.state, "insufficient");
  });

  it("sin item level del jugador no queda ninguna comparación en pie", () => {
    // null es "no disponible" (regla 5): no se sustituye por la mediana ni por
    // un cero, que se leería como un personaje desnudo. Y sin esa cifra la caja
    // no tiene nada que comparar, así que no se queda en `comparable` vacía.
    const gap = gapFor({
      rating: 1994,
      player: player(null),
      adoptions: NO_ADOPTIONS,
      target: segment(2000, { population: 300, gear: 312 }),
    });

    assert.notEqual(gap.state, "comparable");
  });
});

describe("listFor", () => {
  const target = [
    adoption("WAIST:1", 0.41, 312),
    adoption("WAIST:2", 0.54, 312),
    adoption("HEAD:3", 0.2, 312),
  ];
  const own = [adoption("WAIST:1", 0.21, 305), adoption("HEAD:3", 0.19, 305)];

  it("la n de la lista sale de la fila, no del escalón", () => {
    // Casi siempre coinciden; el día que no, la que manda es la de la fila,
    // que es sobre quien de verdad se calculó el porcentaje.
    const list = listFor({ own, target, playerKeys: null });

    assert.equal(list.state === "listed" && list.sample, 312);
  });

  it("sin base arriba no hay lista, y lo que se dice es lo que hay arriba", () => {
    const list = listFor({ own, target: [adoption("WAIST:1", 0.41, 12)], playerKeys: null });

    assert.equal(list.state, "insufficient");
    assert.equal(list.state === "insufficient" && list.missing, "target");
    assert.equal(list.state === "insufficient" && list.sample, 12);
  });

  it("sin base abajo tampoco hay lista, porque la fila dice dos porcentajes", () => {
    // El "21% en tu tramo" necesita su propia base: sin ella sería un 0/0
    // pintado como un dato, y la caja estaría comparando contra nada.
    const list = listFor({ own: [], target, playerKeys: null });

    assert.equal(list.state === "insufficient" && list.missing, "own");
    assert.equal(list.state === "insufficient" && list.sample, 0);
  });

  it("un escalón muestreado del que no se calculó ninguna fila no tiene lista", () => {
    // Es la lectura de `readAdoptionFor`: sin filas, "todavía no se ha
    // calculado ahí". El denominador de la lista es cero por ese camino.
    const list = listFor({ own, target: [], playerKeys: null });

    assert.equal(list.state === "insufficient" && list.missing, "target");
  });

  it("solo se marca lo que llevas cuando su equipo está leído", () => {
    const marked = listFor({ own, target, playerKeys: new Set(["WAIST:2"]) });
    const unread = listFor({ own, target, playerKeys: null });

    assert.deepEqual(
      marked.state === "listed" && marked.differences.map((row) => row.playerHasIt),
      [true, false],
    );
    // Sin equipo leído no se marca ninguna: una fila sin marca entre otras
    // marcadas afirmaría "esto no lo llevas" (regla 5).
    assert.deepEqual(
      unread.state === "listed" && unread.differences.map((row) => row.playerHasIt),
      [false, false],
    );
  });

  it("las diferencias pequeñas no llegan a la lista", () => {
    // HEAD:3 se lleva casi igual arriba y abajo: no discrimina, y §13.5 dice
    // que eso se oculta en vez de rellenar la lista con ello.
    const list = listFor({ own, target, playerKeys: null });

    assert.deepEqual(list.state === "listed" && list.differences.map((row) => row.variable.key), [
      "WAIST:2",
      "WAIST:1",
    ]);
  });

  it("arrastra el icono de la fila de arriba, que core no conoce", () => {
    const withIcon = [adoption("WAIST:2", 0.54, 312, { iconUrl: "https://example.test/i.jpg" })];
    const list = listFor({ own, target: withIcon, playerKeys: null });

    assert.equal(
      list.state === "listed" && list.differences[0]?.iconUrl,
      "https://example.test/i.jpg",
    );
  });

  it("declara cuántos quedaron fuera del denominador", () => {
    const list = listFor({
      own,
      target: [adoption("WAIST:2", 0.54, 312, { unavailable: 88 })],
      playerKeys: null,
    });

    assert.equal(list.state === "listed" && list.unavailable, 88);
  });
});

describe("las claves con las que se marca lo que ya llevas", () => {
  function gear(overrides: Partial<CharacterGearRead["items"][number]> = {}): CharacterGearRead {
    return {
      items: [
        {
          slot: "FINGER_1",
          itemId: 228858,
          itemName: null,
          itemLevel: null,
          quality: null,
          iconUrl: null,
          gemItemIds: [213743],
          enchantmentIds: [7936],
          ...overrides,
        },
      ],
      equippedItemLevel: 263,
      provenance: { observedAt: COMPUTED_AT, source: "profile" },
    };
  }

  it("un anillo se busca por su grupo de slot, que es como se agregó", () => {
    // Si se buscara como FINGER_1 y estuviera guardado como FINGER, la marca no
    // aparecería nunca y nadie vería un error.
    assert.ok(gearKeys(gear())?.has("FINGER:228858"));
  });

  it("las gemas y los encantamientos entran con su propio prefijo", () => {
    const keys = gearKeys(gear());

    assert.ok(keys?.has("gem:213743"));
    assert.ok(keys?.has("enchant:7936"));
  });

  it("sin equipo leído no hay claves, que no es lo mismo que no tener ninguna", () => {
    assert.equal(gearKeys(null), null);
    assert.equal(talentKeys(null), null);
  });

  it("un nodo se busca por árbol e id, como lo escribió el agregado", () => {
    const talents: CharacterTalentsRead = {
      nodes: [{ tree: "class", talentId: 99846, talentName: "Toque gélido", rank: 1 }],
      provenance: { observedAt: COMPUTED_AT, source: "profile" },
    };

    assert.ok(talentKeys(talents)?.has("class:99846"));
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
