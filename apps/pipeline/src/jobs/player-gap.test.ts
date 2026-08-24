import assert from "node:assert/strict";
import { test } from "node:test";
import { parseCharacterRef, type PlayerBuild } from "@wowpvp/core";
import { matchersFor, selectActive } from "./player-gap";

const AT = new Date("2026-08-19T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(AT.getTime() - days * DAY);
}

function build(characterId: string): PlayerBuild {
  return {
    characterId,
    rating: 2100,
    gearBySlot: new Map([["HEAD", 1]]),
    talentLoadoutCode: "CODE",
    equippedItemLevel: 630,
    averageItemLevel: 632,
  };
}

const DEFAULTS = { window: null, allActivity: false } as const;

test("el segmento se recorta a quien ha jugado dentro de la ventana", () => {
  const population = [build("a"), build("b")];
  const activity = new Map([
    ["a", daysAgo(2)],
    // Sigue apareciendo en el run, pero su última partida es de hace 20 días.
    ["b", daysAgo(20)],
  ]);

  const active = selectActive(population, activity, AT, DEFAULTS);

  assert.deepEqual(
    active.population.map((p) => p.characterId),
    ["a"],
  );
  assert.equal(active.excludedInactive, 1);
});

test("sin fila de actividad no se da por activo a nadie", () => {
  // Misma decisión que el join interno del agregado: sin serie no se puede
  // afirmar que alguien haya jugado, y colarlo sería el proxy que #16 sustituye.
  const active = selectActive([build("a")], new Map(), AT, DEFAULTS);

  assert.equal(active.population.length, 0);
  assert.equal(active.excludedInactive, 1);
});

test("la ventana se estira a 14 días solo si a 7 no hay muestra", () => {
  const population = Array.from({ length: 40 }, (_, i) => build(`c${i}`));
  const activity = new Map(population.map((p, i) => [p.characterId, daysAgo(i < 20 ? 2 : 9)]));

  const active = selectActive(population, activity, AT, DEFAULTS);

  // 20 a 7 días es "insufficient"; con 14 son 40 y la comparación se sostiene.
  assert.equal(active.window, 14);
  assert.equal(active.population.length, 40);
});

test("una ventana forzada no se reajusta por muestra", () => {
  const population = [build("a"), build("b")];
  const activity = new Map([
    ["a", daysAgo(2)],
    ["b", daysAgo(9)],
  ]);

  const active = selectActive(population, activity, AT, { window: 7, allActivity: false });

  assert.equal(active.window, 7);
  assert.equal(active.population.length, 1);
});

test("--all deja pasar a todo el mundo y lo declara", () => {
  const population = [build("a"), build("b")];
  const active = selectActive(population, new Map(), AT, { window: null, allActivity: true });

  // window null es lo que hace que el reporte avise de que no hay ventana, en
  // vez de enseñar los mismos porcentajes como si describieran el meta actual.
  assert.equal(active.window, null);
  assert.equal(active.population.length, 2);
  assert.equal(active.excludedInactive, 0);
});

test("la ventana se mide desde el momento del run, no desde ahora", () => {
  const population = [build("a")];
  const activity = new Map([["a", daysAgo(3)]]);

  // Con el reloj del run está dentro; con un reloj diez días posterior, fuera.
  // La ventana va forzada para que lo que se compruebe sea el reloj y no la
  // caída a 14 días de §13.4.
  const forced = { window: 7, allActivity: false } as const;
  assert.equal(selectActive(population, activity, AT, forced).population.length, 1);
  const later = new Date(AT.getTime() + 10 * DAY);
  assert.equal(selectActive(population, activity, later, forced).population.length, 0);
});

// --- matchersFor ---

const meta = (realmSlug: string, nameSlug: string) => ({ realmSlug, nameSlug, nameDisplay: "" });

test("matchersFor casa la forma canónica exacta", () => {
  const match = matchersFor(parseCharacterRef("magtheridon/Artháslegend"));

  assert.equal(match.exact(meta("magtheridon", "artháslegend")), true);
  assert.equal(match.exact(meta("magtheridon", "arthaslegend")), false);
});

test("matchersFor casa por plegado a quien escribe sin acentos", () => {
  const match = matchersFor(parseCharacterRef("magtheridon/Arthaslegend"));

  assert.equal(match.folded(meta("magtheridon", "artháslegend")), true);
  assert.equal(match.folded(meta("magtheridon", "ártháslegend")), true);
});

test("matchersFor separa los dos criterios en vez de mezclarlos", () => {
  // Es lo que permite a quien llama probar primero el exacto: en Magtheridon
  // hay cuatro Arthaslegend distintos, y quien escribe el nombre con sus
  // acentos tiene que recibir al suyo, no al primero que se le parezca.
  const match = matchersFor(parseCharacterRef("magtheridon/artháslegend"));

  assert.equal(match.exact(meta("magtheridon", "arthaslegend")), false);
  assert.equal(match.folded(meta("magtheridon", "arthaslegend")), true);
});

test("matchersFor pliega también el reino", () => {
  const match = matchersFor(parseCharacterRef("Confrerie du Thorium/Alice"));

  assert.equal(match.exact(meta("confrérie-du-thorium", "alice")), false);
  assert.equal(match.folded(meta("confrérie-du-thorium", "alice")), true);
});

test("matchersFor sin personaje pedido no casa con nadie", () => {
  const match = matchersFor(null);

  assert.equal(match.exact(meta("magtheridon", "arthaslegend")), false);
  assert.equal(match.folded(meta("magtheridon", "arthaslegend")), false);
});
