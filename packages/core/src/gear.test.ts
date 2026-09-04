import assert from "node:assert/strict";
import { test } from "node:test";

import { GEAR_SLOTS, compareGearSlots, isGearSlot, parseItemQuality } from "./gear";

test("el orden es el de la ficha del juego y los cosméticos van al final", () => {
  const order = [...GEAR_SLOTS];
  assert.equal(order[0], "HEAD");
  assert.ok(order.indexOf("TRINKET_2") < order.indexOf("MAIN_HAND"));
  assert.deepEqual(order.slice(-2), ["SHIRT", "TABARD"]);
});

test("un slot desconocido se ordena al final, no se pierde", () => {
  const observed = ["TABARD", "WEAPON_OF_THE_FUTURE", "HEAD", "NECK"];
  assert.deepEqual([...observed].sort(compareGearSlots), [
    "HEAD",
    "NECK",
    "TABARD",
    "WEAPON_OF_THE_FUTURE",
  ]);
});

test("dos slots desconocidos conservan un orden estable entre ellos", () => {
  assert.ok(compareGearSlots("AAA", "BBB") < 0);
  assert.ok(compareGearSlots("BBB", "AAA") > 0);
});

test("isGearSlot reconoce el vocabulario de Blizzard, no el de pantalla", () => {
  assert.ok(isGearSlot("FINGER_1"));
  assert.ok(!isGearSlot("Anillo"));
});

test("la calidad se normaliza a los tokens, y lo que no se reconoce es null", () => {
  assert.equal(parseItemQuality("EPIC"), "epic");
  assert.equal(parseItemQuality("Artifact"), "artifact");
  // null es "no disponible", nunca una calidad por defecto: pintar un item sin
  // calidad observada como "common" le atribuiría un dato que nadie vio.
  assert.equal(parseItemQuality(null), null);
  assert.equal(parseItemQuality("PRETTY"), null);
});
