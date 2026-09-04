import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateGearItems,
  aggregateHeroTrees,
  aggregateSegment,
  aggregateTalentCodes,
  aggregateTalentNodes,
  groupBySegment,
  summarizeSegment,
} from "./aggregates";
import {
  adoptionRate,
  slotItemAdoption,
  type PlayerBuild,
  type TalentSelection,
} from "./player-gap";
import { segmentFor } from "./segments";

function build(overrides: Partial<PlayerBuild> & { rating: number }): PlayerBuild {
  return {
    characterId: `c${overrides.rating}-${Math.random()}`,
    gearBySlot: new Map(),
    talentLoadoutCode: null,
    talents: null,
    heroTalentTree: null,
    pvpTalents: null,
    equippedItemLevel: null,
    averageItemLevel: null,
    ...overrides,
  };
}

function withGear(rating: number, slots: Record<string, number>): PlayerBuild {
  return build({ rating, gearBySlot: new Map(Object.entries(slots)) });
}

test("el segmento resume rating e item level de quien lo tiene", () => {
  const summary = summarizeSegment([
    build({ rating: 1810, equippedItemLevel: 620 }),
    build({ rating: 1900, equippedItemLevel: 630 }),
    build({ rating: 1990 }),
  ]);

  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.ratingMedian, 1900);
  assert.equal(summary.ratingMin, 1810);
  assert.equal(summary.ratingMax, 1990);
  // El tercero no tiene perfil: no baja la mediana de item level, sale de ella.
  assert.equal(summary.equippedItemLevelMedian, 625);
  assert.equal(summary.itemLevelSample, 2);
});

test("los denominadores de gear y talentos son independientes del tamaño del segmento", () => {
  const summary = summarizeSegment([
    withGear(1810, { HEAD: 1 }),
    build({ rating: 1850, talentLoadoutCode: "CODE" }),
    build({ rating: 1900 }),
  ]);

  // Tres personajes en el segmento, pero un solo perfil con equipo legible y
  // uno solo con talentos: el n del segmento no es el denominador de nada.
  assert.equal(summary.sampleSize, 3);
  assert.equal(summary.gearSample, 1);
  assert.equal(summary.talentSample, 1);
});

test("los slots intercambiables se cuentan como un grupo", () => {
  const population = [
    withGear(2000, { TRINKET_1: 10, TRINKET_2: 20 }),
    withGear(2050, { TRINKET_1: 20, TRINKET_2: 30 }),
  ];

  const trinkets = aggregateGearItems(population).filter((v) => v.slotGroup === "TRINKET");
  const byKey = new Map(trinkets.map((v) => [v.key, v.adoption]));

  // El item 20 lo llevan los dos, cada uno en un hueco distinto: es adopción
  // del 100%, no dos adopciones del 50% en TRINKET_1 y TRINKET_2.
  assert.equal(byKey.get("TRINKET:20")?.users, 2);
  assert.equal(byKey.get("TRINKET:20")?.value, 1);
  assert.equal(byKey.get("TRINKET:10")?.value, 0.5);
});

test("quien no tiene perfil sale del denominador de gear, no cuenta como no-adopción", () => {
  const population = [withGear(1810, { HEAD: 7 }), build({ rating: 1850 })];

  const head = aggregateGearItems(population).find((v) => v.key === "HEAD:7");
  assert.equal(head?.adoption.users, 1);
  // Uno de dos personajes, pero el porcentaje es 1/1: el otro no es "alguien
  // que no lleva ese casco", es alguien de quien no sabemos el equipo (regla 5).
  assert.equal(head?.adoption.denominator, 1);
  assert.equal(head?.adoption.value, 1);
  assert.equal(head?.adoption.unavailable, 1);
});

test("los cosméticos no generan variables", () => {
  const variables = aggregateGearItems([withGear(1810, { TABARD: 1, SHIRT: 2, HEAD: 3 })]);
  assert.deepEqual(
    variables.map((v) => v.key),
    ["HEAD:3"],
  );
});

test("agregar en una pasada da el mismo número que Player Gap item a item", () => {
  const population = [
    withGear(2010, { HEAD: 1, TRINKET_1: 10, TRINKET_2: 20, FINGER_1: 30, FINGER_2: 30 }),
    withGear(2100, { HEAD: 2, TRINKET_1: 20, TRINKET_2: 40 }),
    withGear(2150, { HEAD: 1, TRINKET_1: 10, FINGER_1: 30 }),
    build({ rating: 2050 }),
  ];

  // Este es el test que impide que las dos implementaciones diverjan: el
  // agregado que se publica y la comparación que ve el jugador tienen que ser
  // el mismo porcentaje sobre el mismo denominador.
  for (const variable of aggregateGearItems(population)) {
    const reference = slotItemAdoption(population, variable.slotGroup!, variable.itemId!);
    assert.deepEqual(variable.adoption, reference, variable.key);
  }
});

test("los talentos ausentes salen del denominador (regla 5)", () => {
  const population = [
    build({ rating: 1810, talentLoadoutCode: "A" }),
    build({ rating: 1850, talentLoadoutCode: "A" }),
    build({ rating: 1900, talentLoadoutCode: "B" }),
    build({ rating: 1950 }),
  ];

  const codes = new Map(aggregateTalentCodes(population).map((v) => [v.key, v.adoption]));
  assert.equal(codes.get("A")?.value, 2 / 3);
  assert.equal(codes.get("A")?.denominator, 3);
  assert.equal(codes.get("A")?.unavailable, 1);
  assert.equal(codes.size, 2);
});

test("una población sin perfiles no inventa variables", () => {
  const variables = aggregateSegment([build({ rating: 1500 }), build({ rating: 1600 })]);
  assert.deepEqual(variables, []);
});

test("se agrega también lo que tiene un solo usuario: el filtro es de presentación", () => {
  const population = [
    withGear(1810, { HEAD: 1 }),
    ...Array.from({ length: 30 }, () => withGear(1850, { HEAD: 2 })),
  ];

  const rare = aggregateSegment(population).find((v) => v.key === "HEAD:1");
  assert.equal(rare?.adoption.users, 1);
});

test("cada personaje cae en un único segmento", () => {
  const population = [{ rating: 1999 }, { rating: 2000 }, { rating: 2199 }];
  const grouped = groupBySegment(population, (rating) => segmentFor(rating));

  assert.deepEqual([...grouped.keys()].sort(), ["1800-2000", "2000-2200"]);
  assert.equal(grouped.get("2000-2200")?.length, 2);
});

// --- Nodos de talento (ADR 0026) ---

const NODES: TalentSelection[] = [
  { tree: "class", talentId: 1, talentName: "Shimmer" },
  { tree: "spec", talentId: 2, talentName: "Frozen Touch" },
];

test("los nodos ausentes salen del denominador, no cuentan como no-adopción", () => {
  // Es la regla 5 sobre la variable nueva, y el motivo por el que `talents` es
  // `null` y no `[]`: un personaje del que solo tenemos la fila de leaderboard
  // no es alguien que "no lleva ese talento".
  const population = [
    build({ rating: 1810, talents: NODES }),
    build({ rating: 1850, talents: [NODES[0]!] }),
    build({ rating: 1900 }),
    build({ rating: 1950 }),
  ];

  const nodes = new Map(aggregateTalentNodes(population).map((v) => [v.key, v.adoption]));
  assert.equal(nodes.get("class:1")?.users, 2);
  assert.equal(nodes.get("class:1")?.denominator, 2);
  assert.equal(nodes.get("class:1")?.unavailable, 2);
  assert.equal(nodes.get("spec:2")?.value, 1 / 2);
});

test("un nodo repetido dentro del mismo personaje sigue siendo un usuario", () => {
  const nodes = aggregateTalentNodes([build({ rating: 1810, talents: [NODES[0]!, NODES[0]!] })]);
  assert.equal(nodes.length, 1);
  assert.equal(nodes[0]?.adoption.users, 1);
});

test("el nombre se recupera del primer personaje que lo traiga", () => {
  // La API deja algún nodo sin tooltip. Si el primero que llega es ese, el
  // agregado no puede quedarse sin etiqueta para siempre.
  const nodes = aggregateTalentNodes([
    build({ rating: 1810, talents: [{ tree: "class", talentId: 1, talentName: null }] }),
    build({ rating: 1850, talents: [{ tree: "class", talentId: 1, talentName: "Shimmer" }] }),
  ]);

  assert.equal(nodes[0]?.talentName, "Shimmer");
  assert.equal(nodes[0]?.talentTree, "class");
  assert.equal(nodes[0]?.talentId, 1);
});

test("nodos, talentos PvP y código tienen cada uno su denominador", () => {
  // El caso que hay durante los primeros días tras el ADR 0026: código guardado
  // desde antes, nodos recién empezados, y talentos PvP que faltan por su
  // cuenta. Un solo denominador describiría mal a las tres.
  const population = [
    build({ rating: 1810, talentLoadoutCode: "A", talents: NODES, pvpTalents: [] }),
    build({ rating: 1850, talentLoadoutCode: "B", talents: NODES }),
    build({ rating: 1900, talentLoadoutCode: "C" }),
  ];

  const summary = summarizeSegment(population);
  assert.equal(summary.talentSample, 3);
  assert.equal(summary.talentNodeSample, 2);
  assert.equal(summary.pvpTalentSample, 1);
});

test("el árbol de héroe se reparte entre los que lo tienen", () => {
  const population = [
    build({ rating: 1810, heroTalentTree: { id: 64, name: "Spellslinger" } }),
    build({ rating: 1850, heroTalentTree: { id: 64, name: "Spellslinger" } }),
    build({ rating: 1900, heroTalentTree: { id: 65, name: "Frostfire" } }),
    build({ rating: 1950 }),
  ];

  const trees = new Map(aggregateHeroTrees(population).map((v) => [v.talentName, v.adoption]));
  assert.equal(trees.get("Spellslinger")?.value, 2 / 3);
  assert.equal(trees.get("Frostfire")?.value, 1 / 3);
  assert.equal(trees.get("Frostfire")?.unavailable, 1);
});

test("la agregación de nodos da el mismo número que adoptionRate uno a uno", () => {
  // El mismo blindaje que ya tiene el gear: el agregado que se publica y la
  // cifra que vería una comparación no pueden divergir en silencio.
  const population = [
    build({ rating: 2010, talents: NODES }),
    build({ rating: 2100, talents: [NODES[0]!] }),
    build({ rating: 2150, talents: [] }),
    build({ rating: 2050 }),
  ];

  for (const variable of aggregateTalentNodes(population)) {
    const reference = adoptionRate(population, (member) =>
      member.talents === null
        ? null
        : member.talents.some((talent) => `${talent.tree}:${talent.talentId}` === variable.key),
    );
    assert.deepEqual(variable.adoption, reference, variable.key);
  }
});
