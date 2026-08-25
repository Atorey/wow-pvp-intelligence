import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isLocalDatabase, assertLocalDatabase, parseOptions } from "./seed";

describe("opciones de seed", () => {
  it("por defecto no resetea y encadena los agregados", () => {
    const options = parseOptions([]);
    assert.equal(options.reset, false);
    assert.equal(options.skipAggregates, false);
    assert.ok(options.seed.length > 0);
  });

  it("acepta semilla, reset y saltarse los agregados", () => {
    const options = parseOptions(["--reset", "--seed", "otra", "--skip-aggregates"]);
    assert.deepEqual(options, { seed: "otra", reset: true, skipAggregates: true });
  });

  it("rechaza una opción desconocida en vez de ignorarla", () => {
    assert.throws(() => parseOptions(["--force"]), /Opción desconocida/);
  });

  it("rechaza --seed sin valor", () => {
    assert.throws(() => parseOptions(["--seed"]), /necesita un valor/);
  });
});

describe("guardarraíl de destino", () => {
  it("acepta las formas de apuntar a esta máquina", () => {
    assert.ok(isLocalDatabase("postgres://postgres:postgres@localhost:5432/wowpvp"));
    assert.ok(isLocalDatabase("postgresql://user:pw@127.0.0.1:5432/wowpvp"));
    assert.ok(isLocalDatabase("postgres://user:pw@[::1]:5432/wowpvp"));
  });

  it("rechaza cualquier host remoto", () => {
    assert.equal(isLocalDatabase("postgres://u:p@db.abcdefg.supabase.co:5432/postgres"), false);
    assert.equal(
      isLocalDatabase("postgres://u:p@aws-0-eu-west-1.pooler.supabase.com:6543/x"),
      false,
    );
  });

  it("falla cerrado: lo que no parsea cuenta como remoto", () => {
    assert.equal(isLocalDatabase("no es una url"), false);
    assert.equal(isLocalDatabase(""), false);
  });

  it("no se deja engañar por un host remoto escrito como si fuera local", () => {
    // El guardarraíl mira el host que resuelve la URL, no si la cadena
    // "contiene localhost": con una comprobación por substring, una base
    // llamada `localhost` en un servidor remoto pasaría el filtro.
    assert.equal(isLocalDatabase("postgres://u:p@evil.example.com:5432/localhost"), false);
    assert.equal(isLocalDatabase("postgres://localhost:pw@remoto.example.com/db"), false);
  });

  it("el error dice a dónde apuntaba y qué hacer", () => {
    assert.throws(() => assertLocalDatabase("postgres://u:p@db.supabase.co:5432/postgres"), {
      message: /db\.supabase\.co[\s\S]*db:migrate/,
    });
  });
});
