import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "@wowpvp/data/fake-db";

import { BucketLimiter, type RateLimitRules, retryAfterSeconds } from "./rate-limit";

const RULES: RateLimitRules = {
  submit: { shortCapacity: 5, shortWindowSeconds: 60, longCapacity: 60, longWindowSeconds: 3_600 },
  suggest: { shortCapacity: 60, shortWindowSeconds: 60 },
  "gap-view": { shortCapacity: 60, shortWindowSeconds: 3_600 },
};

/** Fichas por segundo de cada ventana de `submit`. */
const SHORT_RATE = 5 / 60;
const LONG_RATE = 60 / 3_600;

describe("BucketLimiter", () => {
  it("rechaza una capacidad que concedería la primera petición", () => {
    // El camino de inserción no pasa por el `where`: con capacidad cero la fila
    // nacería con -1 fichas y la primera pasaría igual.
    assert.throws(
      () =>
        new BucketLimiter(fakeDb(), { ...RULES, suggest: { ...RULES.suggest, shortCapacity: 0 } }),
      /suggest/,
    );
  });

  it("deja pasar cuando la sentencia devuelve fila, y en un solo viaje", async () => {
    const db = fakeDb([{ short_tokens: 4, long_tokens: 59 }]);

    const verdict = await new BucketLimiter(db, RULES).take("submit", "clave");

    assert.deepEqual(verdict, { limited: false });
    assert.equal(db.calls.length, 1, "el camino feliz no paga el segundo viaje");
  });

  it("manda las dos ventanas de los envíos y ninguna segunda para los demás", async () => {
    // Un ámbito de una sola ventana pasa nulos, que es lo que deja la columna
    // larga nula sin necesitar un valor mágico.
    const submit = fakeDb([{ short_tokens: 4, long_tokens: 59 }]);
    await new BucketLimiter(submit, RULES).take("submit", "clave");

    const suggest = fakeDb([{ short_tokens: 59, long_tokens: null }]);
    await new BucketLimiter(suggest, RULES).take("suggest", "clave");

    assert.deepEqual(submit.calls[0]?.values, ["submit", "clave", 5, SHORT_RATE, 60, LONG_RATE]);
    assert.deepEqual(suggest.calls[0]?.values, ["suggest", "clave", 60, 1, null, null]);
  });

  it("al limitar por la ventana corta, espera lo que tarda en entrar la ficha que falta", async () => {
    // Cero filas = limitado. A 5 fichas por minuto, la siguiente entra en 12 s.
    const db = fakeDb([], [{ short_tokens: 0, long_tokens: 40, idle_seconds: 0 }]);

    const verdict = await new BucketLimiter(db, RULES).take("submit", "clave");

    assert.deepEqual(verdict, { limited: true, retryAfterMs: Math.ceil(1000 / SHORT_RATE) });
    assert.equal(db.calls.length, 2, "el segundo viaje solo se paga al limitar");
  });

  it("cuenta el rellenado transcurrido desde el último descuento", async () => {
    // Falta media ficha en vez de una entera porque ya han pasado seis segundos.
    const db = fakeDb([], [{ short_tokens: 0, long_tokens: 40, idle_seconds: 6 }]);

    const verdict = await new BucketLimiter(db, RULES).take("submit", "clave");

    assert.deepEqual(verdict, { limited: true, retryAfterMs: Math.ceil(500 / SHORT_RATE) });
  });

  it("al limitar por la ventana larga, espera la de la ventana larga", async () => {
    // Ráfaga disponible y presupuesto horario seco: manda el que falta más.
    const db = fakeDb([], [{ short_tokens: 5, long_tokens: 0, idle_seconds: 0 }]);

    const verdict = await new BucketLimiter(db, RULES).take("submit", "clave");

    assert.deepEqual(verdict, { limited: true, retryAfterMs: Math.ceil(1000 / LONG_RATE) });
  });

  it("acepta los números como los devuelve el driver, sean string o no", async () => {
    const db = fakeDb([], [{ short_tokens: "0", long_tokens: "40", idle_seconds: "0" }]);

    const verdict = await new BucketLimiter(db, RULES).take("submit", "clave");

    assert.deepEqual(verdict, { limited: true, retryAfterMs: Math.ceil(1000 / SHORT_RATE) });
  });

  it("no se cae si la fila ya no está", async () => {
    // Al revés que la cuota, donde una fila ausente significa base sin migrar:
    // aquí es normal —la borró un barrido, o una carrera— y el próximo intento
    // la creará llena.
    const db = fakeDb([], []);

    const verdict = await new BucketLimiter(db, RULES).take("suggest", "clave");

    assert.deepEqual(verdict, { limited: true, retryAfterMs: 1_000 });
  });
});

describe("la cabecera Retry-After", () => {
  it("redondea hacia arriba y nunca dice cero", () => {
    assert.equal(retryAfterSeconds(1), "1");
    assert.equal(retryAfterSeconds(12_000), "12");
    assert.equal(retryAfterSeconds(12_001), "13");
  });
});
