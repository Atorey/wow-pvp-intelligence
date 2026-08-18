import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALL_SPECS,
  parseShuffleBracket,
  requireSpec,
  shuffleBracketId,
  unknownShuffleBrackets,
} from "./specs";

test("el bracket de shuffle se construye y se resuelve sin ambigüedad", () => {
  const frost = requireSpec("mage", "frost");
  const bracket = shuffleBracketId(frost);
  assert.equal(bracket, "shuffle-mage-frost");
  assert.deepEqual(parseShuffleBracket(bracket), frost);
});

test("los slugs compuestos van sin guion, como los nombra Blizzard", () => {
  // Verificado contra la API (temporada 41): las formas con guion dan 404, no
  // una lista vacía. Son 7 de las 40 specs, así que un error aquí se lleva por
  // delante dos clases enteras al ampliar cobertura (#13).
  assert.equal(shuffleBracketId(requireSpec("death-knight", "frost")), "shuffle-deathknight-frost");
  assert.equal(shuffleBracketId(requireSpec("demon-hunter", "havoc")), "shuffle-demonhunter-havoc");
  assert.equal(
    shuffleBracketId(requireSpec("hunter", "beast-mastery")),
    "shuffle-hunter-beastmastery",
  );
});

test("un bracket aplastado se resuelve de vuelta a su spec", () => {
  // De "shuffle-deathknight-frost" no se recupera classSlug partiendo por
  // guiones: solo el catálogo sabe que es death-knight.
  const dk = requireSpec("death-knight", "frost");
  assert.deepEqual(parseShuffleBracket("shuffle-deathknight-frost"), dk);
  assert.equal(parseShuffleBracket("shuffle-death-knight-frost"), undefined);
});

test("un bracket desconocido no se adivina, devuelve undefined", () => {
  assert.equal(parseShuffleBracket("shuffle-mage-arcane-frost"), undefined);
});

test("una spec inexistente falla al arrancar, no en silencio", () => {
  assert.throws(() => requireSpec("mage", "fireball"), /Spec desconocida/);
});

test("el catálogo no tiene brackets duplicados", () => {
  const brackets = ALL_SPECS.map(shuffleBracketId);
  assert.equal(new Set(brackets).size, brackets.length);
});

test("el catálogo cubre las specs que Blizzard publica hoy", () => {
  // Verificado contra el índice de la temporada 41 (EU): 40 brackets de shuffle
  // por spec, más "shuffle-overall", que es el agregado y no una spec.
  assert.equal(ALL_SPECS.length, 40);
  assert.deepEqual(requireSpec("demon-hunter", "devourer").label, "Devourer Demon Hunter");
});

test("un bracket publicado que el catálogo no mapea se reporta", () => {
  // El caso real que motivó el chequeo: Devourer llevaba 5.000 entradas
  // publicadas y no estaba en el catálogo, así que no se ingería en ningún sitio.
  const published = ["shuffle-mage-frost", "shuffle-demonhunter-devourer", "shuffle-clase-nueva"];
  assert.deepEqual(unknownShuffleBrackets(published), ["shuffle-clase-nueva"]);
});

test("el agregado y los brackets de otros modos no cuentan como desconocidos", () => {
  // "shuffle-overall" no es una spec, y 2v2/blitz son otros modos: ninguno debe
  // disparar el aviso de "spec nueva sin ingerir".
  assert.deepEqual(unknownShuffleBrackets(["shuffle-overall", "2v2", "blitz-mage-frost"]), []);
});
