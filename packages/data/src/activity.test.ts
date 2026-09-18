import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "./fake-db";
import { readActiveCharacters } from "./activity";

const SINCE = new Date("2026-09-11T03:00:00Z");

const KEY = {
  region: "eu" as const,
  seasonId: 42,
  brackets: ["shuffle-mage-frost", "shuffle-priest-holy"],
  since: SINCE,
};

describe("readActiveCharacters", () => {
  it("cuenta personajes distintos y separa la evidencia del recuento", async () => {
    const db = fakeDb([{ observed: 42_100, by_delta: 3_400 }]);

    const read = await readActiveCharacters(db, KEY);
    assert.deepEqual(read, { observed: 42_100, byDelta: 3_400, byFirstSeen: 38_700 });
  });

  it("agrupa por personaje antes de contar, no por fila de la tabla", async () => {
    // `character_activity` lleva una fila por personaje y bracket, así que quien
    // juega dos specs de la modalidad está dos veces. Un `count(*)` a pelo sobre
    // la tabla diría que hay más gente de la que hay.
    const db = fakeDb([{ observed: 1, by_delta: 1 }]);
    await readActiveCharacters(db, KEY);

    const [call] = db.calls;
    assert.ok(call);
    assert.match(call.text, /group by a\.character_id/);
    // Y la evidencia se resuelve por persona: con delta en una spec y arranque
    // en otra, jugó.
    assert.match(call.text, /bool_or\(a\.evidence = 'played-delta'\)/);
  });

  it("acota por región, que no está en la tabla de actividad", async () => {
    const db = fakeDb([{ observed: 0, by_delta: 0 }]);
    await readActiveCharacters(db, KEY);

    const [call] = db.calls;
    assert.ok(call);
    assert.match(call.text, /join characters c on c\.id = a\.character_id/);
    assert.match(call.text, /c\.region = \$1/);
  });

  it("recorta por la lista de brackets recibida, nunca por un prefijo", async () => {
    // Con un `like 'shuffle-%'`, `shuffle-overall` —que es la suma de todas las
    // specs— duplicaría la modalidad entera, y una spec nueva que el catálogo no
    // mapee entraría sin que nadie lo decida.
    const db = fakeDb([{ observed: 0, by_delta: 0 }]);
    await readActiveCharacters(db, KEY);

    const [call] = db.calls;
    assert.ok(call);
    assert.doesNotMatch(call.text, /like/i);
    assert.deepEqual(call.values[2], ["shuffle-mage-frost", "shuffle-priest-holy"]);
    assert.equal(call.values[3], SINCE);
  });

  it("sin brackets no va a la base de datos", async () => {
    const db = fakeDb();
    const read = await readActiveCharacters(db, { ...KEY, brackets: [] });

    assert.deepEqual(read, { observed: 0, byDelta: 0, byFirstSeen: 0 });
    assert.equal(db.calls.length, 0);
  });
});
