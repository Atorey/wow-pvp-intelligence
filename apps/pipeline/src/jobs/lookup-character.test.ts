import assert from "node:assert/strict";
import { test } from "node:test";
import { parseOptions } from "./lookup-character";

test("parseOptions acepta varios personajes en una sola corrida", () => {
  const options = parseOptions([
    "--character",
    "ragnaros/alice",
    "--character",
    "Twisting-Nether/Bob",
  ]);

  assert.deepEqual(options.refs, [
    { realmSlug: "ragnaros", nameSlug: "alice" },
    { realmSlug: "twisting-nether", nameSlug: "bob" },
  ]);
  assert.equal(options.force, false);
});

test("parseOptions entiende --force sin valor", () => {
  const options = parseOptions(["--force", "--character", "ragnaros/alice"]);

  assert.equal(options.force, true);
  assert.equal(options.refs.length, 1);
});

test("parseOptions exige al menos un personaje", () => {
  // Sin destino no hay búsqueda: mejor fallar aquí que abrir un pool y una
  // conexión con Blizzard para no hacer nada.
  assert.throws(() => parseOptions([]), /--character/);
  assert.throws(() => parseOptions(["--force"]), /--character/);
});

test("parseOptions rechaza una opción desconocida en vez de ignorarla", () => {
  assert.throws(() => parseOptions(["--characters", "ragnaros/alice"]), /Opción desconocida/);
});

test("parseOptions no se traga la opción siguiente como valor", () => {
  assert.throws(() => parseOptions(["--character", "--force"]), /necesita un valor/);
});

test("parseOptions valida la forma del personaje antes de gastar cuota", () => {
  assert.throws(() => parseOptions(["--character", "alice"]), /reino\/nombre/);
});
