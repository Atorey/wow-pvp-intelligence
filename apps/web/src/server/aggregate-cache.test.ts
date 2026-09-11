import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "@wowpvp/data/fake-db";
import type { QueryRow } from "@wowpvp/data";

import { cachedBracketSegments, cachedRunPopulation } from "./aggregate-cache";

/**
 * Lo que se comprueba aquí es **cuántas veces se va a la base**, que es la única
 * razón por la que esta caché existe. La forma de la SQL ya la protegen los
 * tests de `packages/data`.
 */

/** Una fila de `population_segments` con lo justo para que el mapeo no se queje. */
function row(computedAt: Date, id = "41"): QueryRow {
  return {
    id,
    computed_at: computedAt,
    region: "eu",
    season_id: 42,
    bracket: "shuffle-mage-frost",
    class_slug: "mage",
    spec_slug: "frost",
    segment_id: "1800-2000",
    segment_min: 1800,
    segment_max: 2000,
    activity_window_days: 7,
    sample_size: 300,
    gear_sample: 120,
    talent_sample: 100,
    talent_node_sample: 90,
    pvp_talent_sample: 80,
    item_level_sample: 110,
    rating_median: "1900",
    rating_p25: "1850",
    rating_p75: "1950",
    rating_min: 1800,
    rating_max: 1999,
    equipped_item_level_median: "639",
    profile_data_from: computedAt,
    profile_data_to: computedAt,
    excluded_search: 0,
    active_by_delta: 200,
    active_by_first_seen: 100,
  };
}

/** Cada test usa su propio bracket: la caché es un módulo y vive entre tests. */
const key = (bracket: string) => ({ region: "eu" as const, seasonId: 42, bracket });

describe("la caché de agregados por proceso", () => {
  it("no vuelve a la base mientras la corrida siga siendo la última", async () => {
    const fresh = new Date();
    const db = fakeDb([row(fresh)], [row(fresh)]);

    const first = await cachedBracketSegments(db, key("shuffle-mage-frost"));
    const second = await cachedBracketSegments(db, key("shuffle-mage-frost"));

    assert.equal(db.calls.length, 1);
    assert.equal(second, first);
  });

  it("la población de la corrida se pide una vez por región, no una por spec", async () => {
    const fresh = new Date();
    const run = {
      season_id: 42,
      computed_at: fresh,
      bracket: "shuffle-mage-frost",
      population: 300,
    };
    const db = fakeDb([run], [run]);

    await cachedRunPopulation(db, "eu");
    await cachedRunPopulation(db, "eu");

    assert.equal(db.calls.length, 1);
  });

  it("una corrida retrasada se recuerda igual, por el suelo de vigencia", async () => {
    // Diez días atrás, que es el caso real que apareció al medir: su caducidad
    // natural ya venció. Sin suelo, la caché fallaría en todas las visitas y la
    // base recibiría la avalancha el día que el recálculo está caído — y para
    // nada, porque hasta que no corra el job la respuesta es la misma.
    const old = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
    const db = fakeDb([row(old)], [row(old)]);

    await cachedBracketSegments(db, key("shuffle-priest-holy"));
    await cachedBracketSegments(db, key("shuffle-priest-holy"));

    assert.equal(db.calls.length, 1);
  });

  it("un escalón que no se ha calculado nunca no se recuerda", async () => {
    // Sin filas no hay `computed_at`, así que no hay vigencia que aplicar.
    // Recordar el vacío un día entero taparía la primera corrida que lo llene.
    const db = fakeDb([], []);

    const first = await cachedBracketSegments(db, key("shuffle-monk-mistweaver"));
    await cachedBracketSegments(db, key("shuffle-monk-mistweaver"));

    assert.deepEqual(first, []);
    assert.equal(db.calls.length, 2);
  });

  it("cada bracket tiene su entrada", async () => {
    const fresh = new Date();
    const db = fakeDb([row(fresh)], [row(fresh)]);

    await cachedBracketSegments(db, key("shuffle-druid-balance"));
    await cachedBracketSegments(db, key("shuffle-druid-feral"));

    assert.equal(db.calls.length, 2);
  });

  it("una lectura que falla no deja la promesa rechazada en la caché", async () => {
    let attempts = 0;
    const failing = {
      query: () => {
        attempts += 1;
        return Promise.reject(new Error("el pooler no responde"));
      },
    };

    await assert.rejects(cachedBracketSegments(failing, key("shuffle-rogue-sublety")));
    await assert.rejects(cachedBracketSegments(failing, key("shuffle-rogue-sublety")));

    // Si el fallo se quedara guardado, la segunda visita heredaría el error
    // durante un día entero: una caída de un segundo se volvería una de un día.
    assert.equal(attempts, 2);
  });
});
