import assert from "node:assert/strict";
import { test } from "node:test";
import { MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM, segmentFor } from "@wowpvp/core";
import {
  buildPairs,
  hasFreshProfile,
  parseOptions,
  planArenaCensus,
  planProfiles,
  planRun,
  type Candidate,
  type PairState,
} from "./refresh-profiles";

const NOW = new Date("2026-08-26T12:00:00Z");
const DAY = 86_400_000;
const DEFAULT_BUDGET = 6_000;
const DEFAULT_ARENA_SHARE = 0.2;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function candidate(overrides: Partial<Candidate> & { characterId: string }): Candidate {
  return {
    realmSlug: "ravencrest",
    nameSlug: `char-${overrides.characterId}`,
    bracket: "shuffle-mage-frost",
    seasonId: 42,
    rating: 1900,
    lastActiveAt: daysAgo(1),
    lastProfileAt: null,
    ...overrides,
  };
}

/** `count` personajes del mismo par, numerados para que sus ids no choquen. */
function crowd(count: number, overrides: Partial<Candidate> = {}): Candidate[] {
  return Array.from({ length: count }, (_, i) =>
    candidate({
      characterId: `${overrides.bracket ?? "m"}-${overrides.rating ?? 1900}-${i}`,
      ...overrides,
    }),
  );
}

function pair(overrides: Partial<PairState> & { subjectsBelow: number }): PairState {
  return {
    bracket: "shuffle-mage-frost",
    segment: segmentFor(2000),
    window: 7,
    fresh: 0,
    stale: crowd(200, { rating: 2000 }),
    ...overrides,
  };
}

// --- Argumentos ---

test("el presupuesto se puede acotar por línea de comandos, pero no a cualquier cosa", () => {
  assert.equal(parseOptions([], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE).budget, DEFAULT_BUDGET);
  assert.equal(parseOptions(["--budget", "800"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE).budget, 800);
  assert.throws(
    () => parseOptions(["--budget", "0"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE),
    /mayor que 0/,
  );
  assert.throws(
    () => parseOptions(["--budget", "mucho"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE),
    /peticiones/,
  );
  assert.throws(
    () => parseOptions(["--presupuesto", "10"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE),
    /Opción desconocida/,
  );
});

test("la ventana de 30 días no vale para muestrear una base de comparación", () => {
  // 30 días es "season active" (ranking): un segmento muestreado con ella
  // mezclaría el meta de dos parches en el mismo adoption_rate.
  assert.equal(parseOptions(["--window", "14"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE).window, 14);
  assert.throws(
    () => parseOptions(["--window", "30"], DEFAULT_BUDGET, DEFAULT_ARENA_SHARE),
    /season active/,
  );
});

// --- Frescura ---

test("un perfil fuera de la ventana del par no cuenta como base de comparación", () => {
  // No es que no exista: es que refresh-aggregates no lo carga, así que para
  // este job es igual que no tenerlo.
  assert.equal(hasFreshProfile({ lastProfileAt: daysAgo(3) }, NOW, 7), true);
  assert.equal(hasFreshProfile({ lastProfileAt: daysAgo(9) }, NOW, 7), false);
  assert.equal(hasFreshProfile({ lastProfileAt: daysAgo(9) }, NOW, 14), true);
  assert.equal(hasFreshProfile({ lastProfileAt: null }, NOW, 14), false);
});

// --- Estado de los pares ---

test("la ventana de cada par es la que elegirá el agregado, no una del job", () => {
  const pairs = buildPairs(
    [
      // 1800-2000: 40 activos esta semana, así que el agregado usará 7 días.
      ...crowd(40, { rating: 1900, lastActiveAt: daysAgo(2) }),
      // 2000-2200: solo 10 esta semana y 35 en dos, así que usará 14.
      ...crowd(10, { rating: 2100, lastActiveAt: daysAgo(2) }),
      ...crowd(25, { rating: 2100, lastActiveAt: daysAgo(10) }),
    ],
    NOW,
    null,
  );

  const byId = new Map(pairs.map((p) => [p.segment.id, p]));
  assert.equal(byId.get("1800-2000")?.window, 7);
  assert.equal(byId.get("2000-2200")?.window, 14);
  // Y el pool de candidatos es el de esa ventana: los 25 de hace 10 días entran
  // arriba, donde cuentan, y no habrían entrado con una ventana global de 7.
  assert.equal(byId.get("2000-2200")?.stale.length, 35);
});

test("los sujetos de un par son la población del segmento de debajo", () => {
  const pairs = buildPairs([...crowd(12, { rating: 1900 }), ...crowd(5, { rating: 2100 })], NOW, 7);

  const byId = new Map(pairs.map((p) => [p.segment.id, p]));
  // 2000-2200 sirve a los 12 de 1800-2000; el de abajo no tiene a nadie debajo
  // en esta población, así que no sirve a nadie.
  assert.equal(byId.get("2000-2200")?.subjectsBelow, 12);
  assert.equal(byId.get("1800-2000")?.subjectsBelow, 0);
});

test("un perfil dentro de la ventana sale de los candidatos y cuenta como gear", () => {
  const pairs = buildPairs(
    [
      ...crowd(3, { rating: 2100, lastProfileAt: daysAgo(2) }),
      ...crowd(4, { rating: 2100, lastProfileAt: daysAgo(20) }),
    ],
    NOW,
    7,
  );

  const target = pairs.find((p) => p.segment.id === "2000-2200");
  assert.equal(target?.fresh, 3);
  assert.equal(target?.stale.length, 4);
});

// --- Plan de gasto ---

test("el ICP se cubre entero antes que nada de fuera, tenga los sujetos que tenga", () => {
  const pairs = [
    // El fondo de la ladder al empezar temporada: mucha más gente debajo...
    pair({ bracket: "shuffle-priest-discipline", segment: segmentFor(300), subjectsBelow: 402 }),
    // ...que el tramo donde vive el ICP.
    pair({ bracket: "shuffle-priest-holy", segment: segmentFor(1900), subjectsBelow: 100 }),
  ];

  // Presupuesto para un solo suelo: se lo lleva el par del ICP, aunque el otro
  // tenga cuatro veces más sujetos debajo. Ordenar solo por población mandaría
  // el presupuesto a 200-400, que no le sirve a ningún jugador del ICP.
  const plan = planRun(pairs, MIN_SAMPLE_MEDIUM * 4);

  assert.deepEqual(
    plan.pairs.map((p) => [p.state.segment.id, p.profiles]),
    [["1800-2000", MIN_SAMPLE_MEDIUM]],
  );
  assert.equal(plan.icpProfiles, MIN_SAMPLE_MEDIUM);
});

test("el objetivo del ICP va antes que el suelo de fuera del ICP", () => {
  const pairs = [
    pair({ bracket: "shuffle-priest-discipline", segment: segmentFor(300), subjectsBelow: 402 }),
    pair({ bracket: "shuffle-priest-holy", segment: segmentFor(1900), subjectsBelow: 100 }),
  ];

  const plan = planRun(pairs, 130 * 4);

  // 100 al par del ICP (suelo y objetivo) y los 30 restantes al de fuera: solo
  // se sale del ICP cuando ya no queda nada que subir dentro.
  assert.deepEqual(
    plan.pairs.map((p) => [p.state.segment.id, p.profiles]),
    [
      ["1800-2000", MIN_SAMPLE_HIGH],
      ["200-400", MIN_SAMPLE_MEDIUM],
    ],
  );
  assert.equal(plan.icpProfiles, MIN_SAMPLE_HIGH);
});

test("no se muestrea un segmento objetivo que no tiene sujetos debajo", () => {
  // Es la decisión 5 del ADR 0010 llevada al extremo: por muy poblado que esté
  // 2600-2800, su gear no le sirve a nadie si no hay nadie en 2400-2600.
  const plan = planRun([pair({ subjectsBelow: 0 })], DEFAULT_BUDGET);

  assert.equal(plan.pairs.length, 0);
  assert.equal(plan.servesNobody, 1);
});

test("con presupuesto corto, primero el suelo de todos y después el objetivo", () => {
  const pairs = [
    pair({ bracket: "shuffle-priest-holy", subjectsBelow: 474 }),
    pair({ bracket: "shuffle-warrior-arms", subjectsBelow: 182 }),
  ];

  // 60 perfiles: justo el suelo de los dos pares, sin nada para subir a 100.
  const plan = planRun(pairs, 60 * 4);

  assert.equal(plan.profiles, 60);
  assert.deepEqual(
    plan.pairs.map((p) => [p.state.bracket, p.profiles]),
    [
      ["shuffle-priest-holy", MIN_SAMPLE_MEDIUM],
      ["shuffle-warrior-arms", MIN_SAMPLE_MEDIUM],
    ],
  );
  // Nadie se queda corto: los dos pares quedan servibles, en confianza medium.
  assert.equal(plan.shortOfBudget, 0);
});

test("el suelo del segundo par gana al objetivo del primero", () => {
  const pairs = [
    pair({ bracket: "shuffle-priest-holy", subjectsBelow: 474 }),
    pair({ bracket: "shuffle-warrior-arms", subjectsBelow: 182 }),
  ];

  // 40 perfiles: si el orden fuese "objetivo primero", el par grande se llevaría
  // los 40 y el segundo se quedaría sin comparación ninguna.
  const plan = planRun(pairs, 40 * 4);

  assert.deepEqual(
    plan.pairs.map((p) => [p.state.bracket, p.profiles]),
    [
      ["shuffle-priest-holy", 30],
      ["shuffle-warrior-arms", 10],
    ],
  );
  assert.equal(plan.shortOfBudget, 1);
});

test("con presupuesto de sobra se sube hasta el objetivo, y ni un perfil más", () => {
  const plan = planRun([pair({ subjectsBelow: 474 })], DEFAULT_BUDGET);

  assert.equal(plan.profiles, MIN_SAMPLE_HIGH);
  assert.equal(plan.pairs[0]?.toFloor, MIN_SAMPLE_MEDIUM);
  assert.equal(plan.requests, MIN_SAMPLE_HIGH * 4);
});

test("lo que ya está fresco no se vuelve a bajar", () => {
  const plan = planRun([pair({ subjectsBelow: 474, fresh: 90 })], DEFAULT_BUDGET);

  // 90 frescos y objetivo 100: se bajan 10, no 100.
  assert.equal(plan.profiles, 10);
  // Y nada de esos 10 es "para llegar al suelo": el suelo ya está pasado.
  assert.equal(plan.pairs[0]?.toFloor, 0);
});

test("un par sin gente para llegar al suelo se declara, no se rellena", () => {
  const plan = planRun(
    [pair({ subjectsBelow: 50, stale: crowd(12, { rating: 2000 }) })],
    DEFAULT_BUDGET,
  );

  // Se bajan los 12 que hay: son población real y sirven para otras cosas
  // (percentiles, item level), pero el par sigue sin poder sostener una
  // comparación y eso se cuenta aparte de la falta de presupuesto.
  assert.equal(plan.profiles, 12);
  assert.equal(plan.shortOfPopulation, 1);
  assert.equal(plan.shortOfBudget, 0);
});

test("el plan no depende del orden en que llegan los pares", () => {
  const pairs = [
    pair({ bracket: "shuffle-warrior-arms", subjectsBelow: 182 }),
    pair({ bracket: "shuffle-priest-holy", subjectsBelow: 474 }),
    pair({ bracket: "shuffle-rogue-assassination", subjectsBelow: 182 }),
  ];

  const straight = planRun(pairs, 70 * 4);
  const reversed = planRun([...pairs].reverse(), 70 * 4);

  assert.deepEqual(
    straight.pairs.map((p) => [p.state.bracket, p.profiles]),
    reversed.pairs.map((p) => [p.state.bracket, p.profiles]),
  );
  // Y el desempate entre los dos de 182 sujetos es alfabético, no de llegada:
  // los dos primeros llegan al suelo y el tercero se lleva lo que sobra.
  assert.deepEqual(
    straight.pairs.map((p) => [p.state.bracket, p.profiles]),
    [
      ["shuffle-priest-holy", MIN_SAMPLE_MEDIUM],
      ["shuffle-rogue-assassination", MIN_SAMPLE_MEDIUM],
      ["shuffle-warrior-arms", 10],
    ],
  );
});

test("el presupuesto es un techo, no una sugerencia", () => {
  const pairs = Array.from({ length: 40 }, (_, i) =>
    pair({ bracket: `shuffle-bracket-${i}`, subjectsBelow: 100 + i }),
  );

  const plan = planRun(pairs, 500);

  assert.equal(plan.requests <= 500, true);
  assert.equal(plan.profiles, 125);
});

// --- Arena (ADR 0049) ---

function arenaPair(
  overrides: Partial<PairState> & { subjectsBelow: number; rating: number },
): PairState {
  const { rating, ...rest } = overrides;
  return pair({
    bracket: "3v3",
    segment: segmentFor(rating),
    stale: crowd(300, { bracket: "3v3", rating }),
    ...rest,
  });
}

test("la cuota de arena se lee como fracción y no admite más del total", () => {
  assert.equal(parseOptions([], DEFAULT_BUDGET, 0.2).arenaShare, 0.2);
  assert.equal(parseOptions(["--arena-share", "0"], DEFAULT_BUDGET, 0.2).arenaShare, 0);
  assert.throws(() => parseOptions(["--arena-share", "1.5"], DEFAULT_BUDGET, 0.2), /entre 0 y 1/);
  assert.throws(() => parseOptions(["--arena-share", "20%"], DEFAULT_BUDGET, 0.2), /entre 0 y 1/);
});

test("la arena se baja en censo: sin objetivo por par, todo el tramo", () => {
  // 100 perfiles de (3v3, 2000-2200) serían unos pocos por spec. Lo que da
  // base por spec es bajárselo a todos los activos del tramo.
  const plan = planArenaCensus([arenaPair({ rating: 2000, subjectsBelow: 700 })], 4_000);

  assert.equal(plan.profiles, 300);
  assert.equal(plan.pending, 0);
});

test("la cuota de arena es un techo, y lo que no cabe queda pendiente", () => {
  const short = planArenaCensus([arenaPair({ rating: 2000, subjectsBelow: 700 })], 400);
  assert.equal(short.profiles, 100);
  assert.equal(short.pending, 200);
});

test("dentro de la arena manda el ICP, y no se muestrea un tramo sin nadie debajo", () => {
  const plan = planArenaCensus(
    [
      arenaPair({ rating: 2600, subjectsBelow: 900 }),
      arenaPair({ rating: 2200, subjectsBelow: 400 }),
      // Por debajo del corte del leaderboard no hay sujetos de arena.
      arenaPair({ rating: 1800, subjectsBelow: 0 }),
    ],
    800,
  );

  assert.deepEqual(
    plan.pairs.map((p) => [p.state.segment.id, p.profiles]),
    [["2200-2400", 200]],
  );
  assert.equal(plan.servesNobody, 1);
});

test("el reparto da a la arena su cuota y a Shuffle el resto", () => {
  const states = [pair({ subjectsBelow: 474 }), arenaPair({ rating: 2000, subjectsBelow: 700 })];

  // 500 peticiones: 100 de arena (25 perfiles) y 400 para Shuffle, que es
  // justo su objetivo de 100 perfiles en el par.
  const { shuffle, arena } = planProfiles(states, 500, 0.2);

  assert.equal(arena.requests, 100);
  assert.equal(shuffle.requests, 400);
  assert.ok(shuffle.pairs.every((p) => p.state.bracket === "shuffle-mage-frost"));
});

test("lo que la arena no gasta vuelve a Shuffle", () => {
  // Arena al día: nadie sin perfil fresco. Shuffle se lleva el presupuesto entero.
  const states = [
    pair({ subjectsBelow: 474, stale: crowd(500, { rating: 2000 }) }),
    arenaPair({ rating: 2000, subjectsBelow: 700, fresh: 300, stale: [] }),
  ];

  // Con 450 y la cuota retenida, Shuffle tendría 360 (90 perfiles). Con la
  // cuota devuelta llega a su objetivo de 100.
  const { shuffle, arena } = planProfiles(states, 450, 0.2);

  assert.equal(arena.requests, 0);
  assert.equal(shuffle.requests, 400);
});

test("con la cuota a cero la arena no recibe nada", () => {
  const { arena } = planProfiles([arenaPair({ rating: 2000, subjectsBelow: 700 })], 6_000, 0);
  assert.equal(arena.profiles, 0);
});
