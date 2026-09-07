import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "@wowpvp/data/fake-db";

import { recentlyNotFound } from "./lookup";

const REF = { realmSlug: "sanguino", nameSlug: "ánatorey" };
const SINCE = new Date("2026-09-07T12:00:00.000Z");

describe("la caché de negativos", () => {
  it("solo mira los 404 que costaron una petición", async () => {
    // Es lo que impide que se autoalimente: si los aciertos de caché contasen,
    // preguntar una vez por minuto mantendría la ventana viva indefinidamente y
    // un personaje que empezara a existir no volvería a verse nunca.
    const db = fakeDb([]);

    await recentlyNotFound(db, "eu", REF, SINCE);

    assert.match(db.calls[0]?.text ?? "", /outcome = 'not-found'/);
    assert.doesNotMatch(db.calls[0]?.text ?? "", /not-found-cached/);
  });

  it("pregunta por la identidad exacta y por la ventana que se le da", async () => {
    const db = fakeDb([]);

    await recentlyNotFound(db, "eu", REF, SINCE);

    assert.deepEqual(db.calls[0]?.values, ["eu", "sanguino", "ánatorey", SINCE.toISOString()]);
  });

  it("con una fila dentro de la ventana, no hay que volver a preguntar a Blizzard", async () => {
    assert.equal(await recentlyNotFound(fakeDb([{ "?column?": 1 }]), "eu", REF, SINCE), true);
    assert.equal(await recentlyNotFound(fakeDb([]), "eu", REF, SINCE), false);
  });
});
