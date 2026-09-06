import assert from "node:assert/strict";
import { test } from "node:test";
import { aggregateGearItems } from "./aggregates";
import { biggestDifferences, gearOverlap } from "./differences";
import { biggestGearDifferences, gearAlignment, type PlayerBuild } from "./player-gap";

function build(id: string, slots: Record<string, number>): PlayerBuild {
  return {
    characterId: id,
    rating: 1900,
    gearBySlot: new Map(Object.entries(slots)),
    talentLoadoutCode: null,
    talents: null,
    heroTalentTree: null,
    pvpTalents: null,
    gems: [],
    enchantments: [],
    equippedItemLevel: null,
    averageItemLevel: null,
  };
}

/** Dos poblaciones donde HEAD:2 sube 40 puntos y HEAD:1 los baja. */
function populations(): { own: PlayerBuild[]; target: PlayerBuild[] } {
  const own = [
    ...Array.from({ length: 8 }, (_, i) => build(`o${i}`, { HEAD: 1, TRINKET_1: 50 })),
    ...Array.from({ length: 2 }, (_, i) => build(`o1${i}`, { HEAD: 2, TRINKET_1: 50 })),
  ];
  const target = [
    ...Array.from({ length: 4 }, (_, i) => build(`t${i}`, { HEAD: 1, TRINKET_1: 50 })),
    ...Array.from({ length: 6 }, (_, i) => build(`t1${i}`, { HEAD: 2, TRINKET_1: 51 })),
  ];
  return { own, target };
}

test("la comparación sobre agregados da lo mismo que la que recorre poblaciones", () => {
  // El mismo seguro que ya tiene aggregateGearItems contra slotItemAdoption: si
  // las dos vías divergieran, el porcentaje que se publica y el que se compara
  // dejarían de describir la misma población, y nada lo delataría.
  const { own, target } = populations();

  const fromAggregates = biggestDifferences(aggregateGearItems(own), aggregateGearItems(target));
  const fromPopulations = biggestGearDifferences(own[0] as PlayerBuild, own, target);

  assert.deepEqual(
    fromAggregates.map((d) => ({ key: d.variable.key, delta: d.delta })),
    fromPopulations.map((d) => ({ key: `${d.slotGroup}:${d.itemId}`, delta: d.delta })),
  );
  assert.deepEqual(
    fromAggregates.map((d) => [d.own, d.target]),
    fromPopulations.map((d) => [d.own, d.target]),
  );
});

test("una variable que arriba no lleva nadie no es candidata", () => {
  // El producto describe lo que lleva el escalón de arriba; no cataloga lo que
  // se lleva abajo y allí falta.
  const { own, target } = populations();
  const differences = biggestDifferences(aggregateGearItems(own), aggregateGearItems(target));

  assert.ok(differences.every((d) => d.target.users > 0));
});

test("lo que no aparece abajo es adopción 0 sobre el denominador de abajo", () => {
  const { own, target } = populations();
  const nuevo = biggestDifferences(aggregateGearItems(own), aggregateGearItems(target)).find(
    (d) => d.variable.key === "TRINKET:51",
  );

  assert.ok(nuevo, "el abalorio que solo se lleva arriba tiene que salir");
  assert.equal(nuevo.own.users, 0);
  // El denominador es real: 10 personas de las que sí tenemos el equipo. Un 0
  // sobre 10 es un dato; un 0 sobre 0 sería no haber mirado.
  assert.equal(nuevo.own.denominator, 10);
  assert.equal(nuevo.own.value, 0);
});

test("las diferencias pequeñas no se enseñan, y la lista sale más corta", () => {
  const own = Array.from({ length: 20 }, (_, i) => build(`o${i}`, { HEAD: i < 10 ? 1 : 2 }));
  // 55/45 frente a 50/50: cinco puntos, por debajo de MIN_DISCRIMINATIVE_DELTA.
  const target = Array.from({ length: 20 }, (_, i) => build(`t${i}`, { HEAD: i < 11 ? 1 : 2 }));

  assert.deepEqual(biggestDifferences(aggregateGearItems(own), aggregateGearItems(target)), []);
});

test("se recorta a top y el orden es estable", () => {
  const { own, target } = populations();
  const uno = biggestDifferences(aggregateGearItems(own), aggregateGearItems(target), { top: 1 });

  assert.equal(uno.length, 1);
  assert.deepEqual(
    uno,
    biggestDifferences(aggregateGearItems(own), aggregateGearItems(target), { top: 1 }),
  );
});

test("un segmento propio sin agregados no rompe: la adopción de abajo es 0 sobre 0", () => {
  // Pasa de verdad al empezar la temporada: el escalón de arriba tiene perfiles
  // y el de abajo aún no se ha calculado. Quien lo pinte decide si eso se
  // enseña; lo que no puede es reventar ni inventar un denominador.
  const { target } = populations();
  const differences = biggestDifferences([], aggregateGearItems(target));

  assert.ok(differences.length > 0);
  assert.equal(differences[0]?.own.denominator, 0);
  assert.equal(differences[0]?.own.value, 0);
});

test("el solapamiento sobre agregados da lo mismo que el que recorre la población", () => {
  // Misma paridad que la de arriba y por el mismo motivo: la cifra que enseña la
  // web y la que calcula el pipeline tienen que ser el mismo número, o la caja
  // estaría describiendo una población distinta de la que publica el segmento.
  const { target } = populations();
  const player = build("p", { HEAD: 2, TRINKET_1: 51, TRINKET_2: 51, TABARD: 999 });

  const fromPopulations = gearAlignment(player, target);
  const fromAggregates = gearOverlap(
    [...player.gearBySlot].map(([slot, itemId]) => ({ slot, itemId })),
    aggregateGearItems(target),
  );

  assert.deepEqual(fromAggregates, fromPopulations);
  // Los dos abalorios iguales cuentan una vez y el tabardo no cuenta: quedan
  // HEAD y TRINKET.
  assert.equal(fromAggregates.comparedItems, 2);
});

test("un item que arriba no lleva nadie cuenta cero, y un hueco no observado no cuenta", () => {
  // La distinción entre "nadie lo lleva" y "de ese hueco no sabemos nada" es la
  // regla 5 aplicada a una media: contar la ausencia de dato como un cero
  // hundiría el porcentaje con algo que no hemos medido.
  const { target } = populations();
  const aggregated = aggregateGearItems(target);

  const nobodyWearsIt = gearOverlap([{ slot: "HEAD", itemId: 999 }], aggregated);
  assert.deepEqual(nobodyWearsIt, { score: 0, comparedItems: 1 });

  const unobservedSlot = gearOverlap([{ slot: "FEET", itemId: 7 }], aggregated);
  assert.deepEqual(unobservedSlot, { score: null, comparedItems: 0 });
});
