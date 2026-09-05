import assert from "node:assert/strict";
import { test } from "node:test";
import { segmentFor } from "./segments";
import {
  MIN_DISCRIMINATIVE_DELTA,
  adoptionRate,
  biggestGearDifferences,
  compareItemLevel,
  compareTalents,
  comparableSlotGroups,
  computePlayerGap,
  gearAlignment,
  isDiscriminative,
  modalItem,
  slotItemAdoption,
  type PlayerBuild,
} from "./player-gap";

/** Constructor corto para no repetir el ruido de PlayerBuild en cada caso. */
function build(
  id: string,
  gear: Record<string, number>,
  talentLoadoutCode: string | null = "CODE-A",
  equippedItemLevel: number | null = 640,
): PlayerBuild {
  return {
    characterId: id,
    rating: 1900,
    gearBySlot: new Map(Object.entries(gear)),
    talentLoadoutCode,
    // Player Gap sigue siendo de gear: los nodos se agregan y se publican, pero
    // la caja no los compara todavía (ADR 0026, decisión 8; issue #18).
    talents: null,
    heroTalentTree: null,
    pvpTalents: null,
    gems: [],
    enchantments: [],
    equippedItemLevel,
    // Deliberadamente distinto del equipado: si algún día la comparación
    // volviera a usar este campo por error, los asserts de abajo fallarían.
    averageItemLevel: equippedItemLevel === null ? null : equippedItemLevel + 20,
  };
}

/** Población de `count` clones, para llegar a los umbrales de confianza sin escribir 100 líneas. */
function population(count: number, make: (index: number) => PlayerBuild): PlayerBuild[] {
  return Array.from({ length: count }, (_, index) => make(index));
}

test("adoptionRate excluye del denominador lo no disponible, no lo cuenta como no-adopción", () => {
  const members = [1, 2, 3, 4];
  // 1 usa la variable, 2 no la usa, 3 y 4 no tienen dato.
  const rate = adoptionRate(members, (n) => (n >= 3 ? null : n === 1));

  assert.equal(rate.users, 1);
  assert.equal(rate.denominator, 2);
  assert.equal(rate.unavailable, 2);
  assert.equal(rate.value, 0.5);
});

test("adoptionRate con denominador 0 da 0, nunca NaN", () => {
  const rate = adoptionRate([1, 2], () => null);
  assert.equal(rate.value, 0);
  assert.equal(rate.denominator, 0);
});

test("los slots cosméticos no se comparan", () => {
  const slots = comparableSlotGroups([build("a", { HEAD: 1, TABARD: 2, SHIRT: 3, HANDS: 4 })]);
  assert.deepEqual(slots, ["HANDS", "HEAD"]);
});

test("abalorios y anillos se normalizan a un grupo: el hueco concreto es irrelevante", () => {
  assert.deepEqual(
    comparableSlotGroups([build("a", { TRINKET_1: 1, TRINKET_2: 2, FINGER_1: 3, FINGER_2: 4 })]),
    ["FINGER", "TRINKET"],
  );

  // El mismo item, en huecos distintos según el jugador: es el mismo hecho.
  const members = [build("a", { TRINKET_1: 7, TRINKET_2: 8 }), build("b", { TRINKET_2: 7 })];
  const rate = slotItemAdoption(members, "TRINKET", 7);
  assert.equal(rate.value, 1);
  assert.equal(rate.users, 2);
});

test("un item repetido en los dos huecos del grupo cuenta como un solo portador", () => {
  const members = [build("a", { FINGER_1: 5, FINGER_2: 5 }), build("b", { FINGER_1: 6 })];
  const rate = slotItemAdoption(members, "FINGER", 5);
  assert.equal(rate.users, 1);
  assert.equal(rate.denominator, 2);
});

test("el mismo item no genera diferencias opuestas por caer en huecos distintos", () => {
  // Arriba lo llevan todos, abajo nadie — pero repartido entre TRINKET_1 y
  // TRINKET_2. Sin agrupar, esto producía dos diferencias de signo contrario.
  const target = population(10, (i) =>
    i % 2 === 0
      ? build(`t${i}`, { TRINKET_1: 7, TRINKET_2: 9 })
      : build(`t${i}`, { TRINKET_1: 9, TRINKET_2: 7 }),
  );
  const own = population(10, (i) => build(`o${i}`, { TRINKET_1: 9, TRINKET_2: 9 }));
  const differences = biggestGearDifferences(
    build("yo", { TRINKET_1: 9, TRINKET_2: 9 }),
    own,
    target,
  );

  assert.deepEqual(
    differences.map((d) => [d.slotGroup, d.itemId, d.delta]),
    [["TRINKET", 7, 1]],
  );
});

test("un perfil sin gear legible sale del denominador de gear", () => {
  const members = [build("a", { HEAD: 1 }), build("b", { HEAD: 2 }), build("sin-equipo", {})];
  const modal = modalItem(members, "HEAD");

  assert.equal(modal?.itemId, 1);
  assert.equal(modal?.adoption.denominator, 2);
  assert.equal(modal?.adoption.unavailable, 1);
});

test("el alignment de gear promedia la adopción real de los items del jugador", () => {
  // En el objetivo: 3 de 4 llevan HEAD=1, 1 de 4 lleva HANDS=9.
  const target = [
    build("a", { HEAD: 1, HANDS: 9 }),
    build("b", { HEAD: 1, HANDS: 8 }),
    build("c", { HEAD: 1, HANDS: 8 }),
    build("d", { HEAD: 2, HANDS: 8 }),
  ];
  const player = build("yo", { HEAD: 1, HANDS: 9 });
  const alignment = gearAlignment(player, target);

  assert.equal(alignment.comparedItems, 2);
  assert.equal(alignment.score, (0.75 + 0.25) / 2);
});

test("los slots que el jugador no lleva no entran en la media de alignment", () => {
  const target = [build("a", { HEAD: 1, HANDS: 9 }), build("b", { HEAD: 1, HANDS: 9 })];
  const alignment = gearAlignment(build("yo", { HEAD: 1 }), target);

  assert.equal(alignment.comparedItems, 1);
  assert.equal(alignment.score, 1);
});

test("sin slots comparables el alignment es null, no 0", () => {
  const alignment = gearAlignment(build("yo", {}), [build("a", { HEAD: 1 })]);
  assert.equal(alignment.score, null);
  assert.equal(alignment.comparedItems, 0);
});

test("solo se listan las diferencias que superan el umbral discriminante", () => {
  assert.equal(isDiscriminative(MIN_DISCRIMINATIVE_DELTA), true);
  assert.equal(isDiscriminative(-MIN_DISCRIMINATIVE_DELTA), true);
  assert.equal(isDiscriminative(MIN_DISCRIMINATIVE_DELTA - 0.001), false);

  // TRINKET_1=7 lo lleva el 100% arriba y el 0% abajo: diferencia enorme.
  // HEAD=1 lo lleva el 100% en ambos: no discrimina nada, es estándar de la spec.
  const target = population(10, () => build("t", { HEAD: 1, TRINKET_1: 7 }));
  const own = population(10, () => build("o", { HEAD: 1, TRINKET_1: 5 }));
  const differences = biggestGearDifferences(build("yo", { HEAD: 1, TRINKET_1: 5 }), own, target);

  assert.equal(differences.length, 1);
  assert.equal(differences[0]?.slotGroup, "TRINKET");
  assert.equal(differences[0]?.itemId, 7);
  assert.equal(differences[0]?.delta, 1);
  assert.equal(differences[0]?.playerHasIt, false);
});

test("la lista de diferencias sale corta antes que rellenarse con ruido", () => {
  const target = population(10, (i) => build(`t${i}`, { HEAD: 1, TRINKET_1: 7 }));
  const own = population(10, (i) => build(`o${i}`, { HEAD: 1, TRINKET_1: 5 }));
  const differences = biggestGearDifferences(build("yo", { HEAD: 1 }), own, target, 5);

  assert.equal(differences.length, 1);
});

test("los candidatos salen del segmento objetivo, no del propio", () => {
  // ITEM 5 solo existe abajo: no se describe como algo del escalón de arriba.
  const target = population(10, (i) => build(`t${i}`, { TRINKET_1: 7 }));
  const own = population(10, (i) => build(`o${i}`, { TRINKET_1: 5 }));
  const differences = biggestGearDifferences(build("yo", { TRINKET_1: 5 }), own, target);

  assert.deepEqual(
    differences.map((d) => d.itemId),
    [7],
  );
});

test("los talentos sin código salen del denominador (regla 5)", () => {
  const target = [
    build("a", {}, "CODE-A"),
    build("b", {}, "CODE-A"),
    build("c", {}, "CODE-B"),
    build("d", {}, null),
  ];
  const comparison = compareTalents(build("yo", {}, "CODE-B"), target);

  assert.equal(comparison.unavailable, 1);
  assert.equal(comparison.distinctCodes, 2);
  assert.equal(comparison.topCodes[0]?.code, "CODE-A");
  // 2 de 3 con dato, no 2 de 4: el perfil sin código no cuenta como no-adopción.
  assert.equal(comparison.topCodes[0]?.adoption.value, 2 / 3);
  assert.equal(comparison.playerCodeAdoption?.value, 1 / 3);
});

test("una spec donde casi nadie repite build se marca como sin señal utilizable", () => {
  // 20 jugadores, 20 códigos distintos: el "más frecuente" es el 5%. Decir que
  // el 5% del segmento usa esa build es cierto y no significa nada.
  const disperso = population(20, (i) => build(`t${i}`, {}, `CODE-${i}`));
  assert.equal(compareTalents(build("yo", {}, "CODE-0"), disperso).hasUsableSignal, false);

  // Con una build mayoritaria de verdad, sí hay algo que contar.
  const concentrado = population(20, (i) => build(`t${i}`, {}, i < 12 ? "CODE-META" : `CODE-${i}`));
  assert.equal(compareTalents(build("yo", {}, "CODE-META"), concentrado).hasUsableSignal, true);
});

test("un código que nadie más lleva da adopción 0, distinto de 'no calculable'", () => {
  const target = [build("a", {}, "CODE-A"), build("b", {}, "CODE-A")];

  const conCodigo = compareTalents(build("yo", {}, "CODE-RARO"), target);
  assert.equal(conCodigo.playerCodeAdoption?.value, 0);
  assert.equal(conCodigo.playerCodeAdoption?.denominator, 2);

  const sinCodigo = compareTalents(build("yo", {}, null), target);
  assert.equal(sinCodigo.playerCode, null);
  assert.equal(sinCodigo.playerCodeAdoption, null);
});

test("el item level comparado es el equipado, no el medio (que cuenta el banco)", () => {
  const own = [build("a", {}, "C", 600), build("b", {}, "C", 600)];
  const target = [build("c", {}, "C", 620), build("d", {}, "C", 620)];
  const comparison = compareItemLevel(build("yo", {}, "C", 610), own, target);

  // Si se usara averageItemLevel, estos serían 630, 620 y 640.
  assert.equal(comparison.player, 610);
  assert.equal(comparison.ownMedian, 600);
  assert.equal(comparison.targetMedian, 620);
});

test("el item level se compara por mediana y solo sobre quien lo tiene disponible", () => {
  const own = [build("a", {}, "C", 600), build("b", {}, "C", 610), build("c", {}, "C", null)];
  const target = [build("d", {}, "C", 640), build("e", {}, "C", 660)];
  const comparison = compareItemLevel(build("yo", {}, "C", 620), own, target);

  assert.equal(comparison.player, 620);
  assert.equal(comparison.ownMedian, 605);
  assert.equal(comparison.targetMedian, 650);
  assert.equal(comparison.ownSample, 2);
  assert.equal(comparison.targetSample, 2);
});

test("por debajo de n=30 en el segmento objetivo no hay comparación, hay motivo", () => {
  const gap = computePlayerGap({
    player: build("yo", { HEAD: 1 }),
    ownSegment: segmentFor(1900),
    targetSegment: segmentFor(2000),
    ownPopulation: population(50, (i) => build(`o${i}`, { HEAD: 1 })),
    targetPopulation: population(29, (i) => build(`t${i}`, { HEAD: 2 })),
  });

  assert.equal(gap.available, false);
  assert.equal(gap.confidence, "insufficient");
  assert.match(gap.available === false ? gap.reason : "", /2000-2200/);
});

test("la confianza declarada es la del segmento objetivo, no la del propio", () => {
  const gap = computePlayerGap({
    player: build("yo", { HEAD: 1 }),
    ownSegment: segmentFor(1900),
    targetSegment: segmentFor(2000),
    // Muestra propia pequeña, objetivo de 100: la comparación se sostiene.
    ownPopulation: population(31, (i) => build(`o${i}`, { HEAD: 1 })),
    targetPopulation: population(100, (i) => build(`t${i}`, { HEAD: 2 })),
  });

  assert.equal(gap.available, true);
  assert.equal(gap.confidence, "high");
  assert.equal(gap.available === true ? gap.ownSampleSize : 0, 31);
});
