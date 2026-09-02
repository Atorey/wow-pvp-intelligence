import assert from "node:assert/strict";
import { test } from "node:test";

import { filterRealms } from "./use-suggestions";

const REALMS = [
  "confrérie-du-thorium",
  "magtheridon",
  "sanguino",
  "twisting-nether",
  "thorium-brotherhood",
];

test("sin nada tecleado se ofrece la lista tal cual", () => {
  assert.deepEqual(filterRealms(REALMS, "  "), REALMS);
});

test("el espacio de lo tecleado casa con el guion del slug", () => {
  assert.deepEqual(filterRealms(REALMS, "Twisting Nether"), ["twisting-nether"]);
});

test("se busca sin acentos y se devuelve con ellos", () => {
  // Quien teclea su reino no escribe el acento, y sin plegar no encontraría el
  // suyo. Lo que sale es la forma canónica, que es la que Blizzard acepta
  // (ADR 0017): plegarla en la respuesta publicaría una ruta que da 404.
  assert.deepEqual(filterRealms(REALMS, "confrerie"), ["confrérie-du-thorium"]);
});

test("casa por dentro del slug, y lo que empieza por lo tecleado va primero", () => {
  assert.deepEqual(filterRealms(REALMS, "thorium"), [
    "thorium-brotherhood",
    "confrérie-du-thorium",
  ]);
});

test("un reino que no conocemos no casa con nada, y eso no es un error", () => {
  // La lista sale de nuestra población, no del catálogo de Blizzard: no casar
  // significa que no le conocemos a nadie, no que el reino no exista. Por eso
  // el campo sigue admitiendo texto libre.
  assert.deepEqual(filterRealms(REALMS, "kazzak"), []);
});
