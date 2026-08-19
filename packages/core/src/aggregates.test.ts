import assert from "node:assert/strict";
import { test } from "node:test";
import {
  aggregateGearItems,
  aggregateSegment,
  aggregateTalentCodes,
  groupBySegment,
  summarizeSegment,
} from "./aggregates";
import { slotItemAdoption, type PlayerBuild } from "./player-gap";
import { segmentFor } from "./segments";

function build(overrides: Partial<PlayerBuild> & { rating: number }): PlayerBuild {
  return {
    characterId: `c${overrides.rating}-${Math.random()}`,
    gearBySlot: new Map(),
    talentLoadoutCode: null,
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
