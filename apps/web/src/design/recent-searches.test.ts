import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_RECENT, type RecentSearch, parseRecent, withRecent } from "./recent-searches";

function entry(nameSlug: string, at = 0): RecentSearch {
  return {
    realmSlug: "sanguino",
    nameSlug,
    nameDisplay: nameSlug,
    specSlug: null,
    rating: null,
    at,
  };
}

test("lo que no tiene la forma esperada se descarta, no rompe", () => {
  assert.deepEqual(parseRecent(null), []);
  assert.deepEqual(parseRecent("{no es json"), []);
  // Un objeto suelto en vez de una lista es lo que dejaría una versión anterior
  // que guardara una sola búsqueda.
  assert.deepEqual(parseRecent('{"realmSlug":"sanguino"}'), []);
  assert.deepEqual(parseRecent('[{"realmSlug":"sanguino"},null,3]'), []);
});

test("una entrada válida sobrevive junto a otras que no lo son", () => {
  const good = entry("ánatorey", 5);
  const raw = JSON.stringify([{ realmSlug: 42 }, good]);
  assert.deepEqual(parseRecent(raw), [good]);
});

test("volver a buscar al mismo personaje lo sube, no lo duplica", () => {
  const list = [entry("a", 1), entry("b", 2)];
  const next = withRecent(list, entry("b", 9));
  assert.deepEqual(
    next.map((item) => item.nameSlug),
    ["b", "a"],
  );
});

test("la lista no crece por encima del tope", () => {
  let list: RecentSearch[] = [];
  for (const name of ["a", "b", "c", "d", "e"]) list = withRecent(list, entry(name));
  assert.equal(list.length, MAX_RECENT);
  assert.equal(list[0]?.nameSlug, "e");
});

test("dos personajes con el mismo nombre en reinos distintos son dos entradas", () => {
  // El plegado de acentos funde 1.626 grupos de homónimos (ADR 0017): la clave
  // es el par reino+nombre canónico, nunca el nombre solo.
  const list = withRecent([{ ...entry("ánatorey"), realmSlug: "magtheridon" }], entry("ánatorey"));
  assert.equal(list.length, 2);
});
