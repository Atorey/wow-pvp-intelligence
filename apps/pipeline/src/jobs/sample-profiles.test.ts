import assert from "node:assert/strict";
import { test } from "node:test";
import { parseSpecSelection, specsFromManifest } from "./sample-profiles";

test("--specs resuelve las claves contra el catálogo", () => {
  const specs = parseSpecSelection("mage-frost, warrior-fury");
  assert.deepEqual(
    specs.map((s) => s.label),
    ["Frost Mage", "Fury Warrior"],
  );
});

test("--specs no parte la clave por guiones", () => {
  // "death-knight-frost" tiene tres tramos y solo el catálogo sabe dónde acaba
  // la clase. Partir por guiones daría clase "death" y spec "knight-frost".
  const specs = parseSpecSelection("death-knight-frost");
  assert.deepEqual(specs[0], {
    classSlug: "death-knight",
    specSlug: "frost",
    label: "Frost Death Knight",
  });
});

test("una spec inexistente en --specs rompe antes de gastar cuota", () => {
  assert.throws(() => parseSpecSelection("mage-fireball"), /Spec desconocida en --specs/);
  assert.throws(() => parseSpecSelection("  ,  "), /no nombra ninguna spec/);
});

test("las specs de un run salen del manifiesto, no de la lista activa", () => {
  // Un run de agosto se reanuda con las specs de agosto aunque el pipeline haya
  // pasado entretanto de 3 specs a 40: si no, entraría población nueva bajo el
  // captured_at del run viejo.
  const manifest = {
    runId: "run-20260814T121556",
    sampledAt: "2026-08-14T12:15:56.000Z",
    region: "eu",
    seed: "sample-profiles",
    limit: 100,
    segmentEntries: [1800, 2000],
    brackets: ["shuffle-mage-frost", "shuffle-shaman-restoration", "shuffle-warrior-fury"],
  };

  assert.deepEqual(
    specsFromManifest(manifest).map((s) => s.label),
    ["Frost Mage", "Restoration Shaman", "Fury Warrior"],
  );
});

test("un run con un bracket que ya no está en el catálogo no se reanuda a medias", () => {
  const manifest = {
    runId: "run-viejo",
    sampledAt: "2026-08-14T12:15:56.000Z",
    region: "eu",
    seed: "sample-profiles",
    limit: 100,
    segmentEntries: [1800],
    brackets: ["shuffle-mage-frost", "shuffle-clase-retirada"],
  };

  assert.throws(() => specsFromManifest(manifest), /shuffle-clase-retirada/);
});
