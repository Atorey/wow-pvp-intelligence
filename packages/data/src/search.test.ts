import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import { MIN_SEARCH_LENGTH, readKnownRealms, searchCharacters } from "./search";

function suggestionRow(overrides: Record<string, unknown> = {}) {
  return {
    realm_slug: "sanguino",
    name_slug: "anatorey",
    name_display: "Anatorey",
    rating: 1834,
    spec_slug: "holy",
    ...overrides,
  };
}

describe("searchCharacters", () => {
  it("pliega lo tecleado y lo pasa como parámetro, sin plegar en SQL", async () => {
    const db = fakeDb([suggestionRow()]);
    await searchCharacters(db, { region: "eu", nameQuery: "Ánatorey" });

    const call = db.calls[0];
    assert.ok(call);
    // La regla de plegado tiene un solo sitio (ADR 0017). Un `unaccent` o un
    // `lower()` aquí sería una segunda verdad que divergiría a la primera letra
    // que se añadiera a la tabla de equivalencias de foldSlug().
    assert.doesNotMatch(call.text, /unaccent|normalize/i);
    assert.equal(call.values[1], "anatorey");
  });

  it("devuelve la forma canónica, no la plegada", async () => {
    const db = fakeDb([suggestionRow({ name_slug: "artháslegend", name_display: "Artháslegend" })]);
    const [found] = await searchCharacters(db, { region: "eu", nameQuery: "arthaslegend" });

    // Publicar el plegado como ruta fundiría a personajes distintos y daría un
    // 404 en la API, que solo conoce la grafía con acentos.
    assert.equal(found?.nameSlug, "artháslegend");
  });

  it("no consulta con menos de tres letras", async () => {
    const db = fakeDb([suggestionRow()]);
    const found = await searchCharacters(db, { region: "eu", nameQuery: "an" });

    assert.deepEqual(found, []);
    assert.equal(db.calls.length, 0, `${MIN_SEARCH_LENGTH} letras es el mínimo para preguntar`);
  });

  it("escapa los comodines de like que traiga lo tecleado", async () => {
    const db = fakeDb([]);
    await searchCharacters(db, { region: "eu", nameQuery: "%_a" });

    // Sin escapar, quien escriba "%" recibe la tabla entera y se lleva por
    // delante el índice de prefijo.
    assert.equal(db.calls[0]?.values[1], "\\%\\_a");
  });

  it("acota al reino solo cuando se da", async () => {
    const conReino = fakeDb([]);
    await searchCharacters(conReino, {
      region: "eu",
      nameQuery: "anatorey",
      realmSlug: "sanguino",
    });
    assert.equal(conReino.calls[0]?.values[2], "sanguino");

    const sinReino = fakeDb([]);
    await searchCharacters(sinReino, { region: "eu", nameQuery: "anatorey" });
    assert.equal(sinReino.calls[0]?.values[2], null);
  });

  it("declara el orden en la consulta y no lo deja al planner", async () => {
    const db = fakeDb([]);
    await searchCharacters(db, { region: "eu", nameQuery: "anatorey" });

    // Con un prefijo corto los candidatos son cientos: sin `order by`, el primer
    // sugerido cambiaría entre dos pulsaciones idénticas.
    assert.match(db.calls[0]?.text ?? "", /order by/);
    assert.match(db.calls[0]?.text ?? "", /rating desc nulls last/);
  });

  it("no pide más de veinte por mucho que se le pida", async () => {
    const db = fakeDb([]);
    await searchCharacters(db, { region: "eu", nameQuery: "anatorey", limit: 5_000 });

    assert.equal(db.calls[0]?.values[3], 20);
  });

  it("null en rating es 'no le hemos visto rating', y sale igual", async () => {
    const db = fakeDb([suggestionRow({ rating: null, spec_slug: null })]);
    const [found] = await searchCharacters(db, { region: "eu", nameQuery: "anatorey" });

    // Un personaje que entró por búsqueda y no juega shuffle existe como
    // identidad: dejarlo fuera de la lista lo haría imposible de encontrar.
    assert.equal(found?.rating, null);
    assert.equal(found?.nameSlug, "anatorey");
  });
});

describe("readKnownRealms", () => {
  it("devuelve los slugs tal como los publica Blizzard, con sus acentos", async () => {
    const db = fakeDb([{ realm_slug: "confrérie-du-thorium" }, { realm_slug: "sanguino" }]);
    const realms = await readKnownRealms(db, "eu");

    assert.deepEqual(realms, ["confrérie-du-thorium", "sanguino"]);
  });
});
