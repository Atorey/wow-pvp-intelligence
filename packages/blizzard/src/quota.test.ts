import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fakeDb } from "@wowpvp/data/fake-db";
import { QuotaLedger, readSharedToken, writeSharedToken, type QuotaLimits } from "./quota";

const LIMITS: QuotaLimits = {
  secondCapacity: 80,
  hourCapacity: 32_000,
  onDemandReserve: 2_000,
};

/** El bucket horario se rellena a `capacidad / 3600` fichas por segundo. */
const HOUR_RATE = LIMITS.hourCapacity / 3_600;

describe("QuotaLedger", () => {
  it("rechaza una reserva que no deja fichas al trabajo de fondo", () => {
    // Sin este límite, `batch` y `aggregate` esperarían una hora que no llega.
    assert.throws(
      () => new QuotaLedger(fakeDb(), { ...LIMITS, onDemandReserve: 32_000 }),
      /BLIZZARD_ON_DEMAND_RESERVE/,
    );
  });

  it("on-demand ve el bucket entero y el resto solo por encima del colchón", async () => {
    const grant = [{ second_tokens: 79, hour_tokens: 31_999 }];

    const urgent = fakeDb(grant);
    await new QuotaLedger(urgent, LIMITS).take("on-demand");

    const background = fakeDb(grant);
    await new QuotaLedger(background, LIMITS).take("aggregate");

    assert.equal(urgent.calls[0]?.values[4], 0, "on-demand gasta hasta la última ficha");
    assert.equal(background.calls[0]?.values[4], 2_000, "el resto respeta la reserva");
  });

  it("devuelve lo que queda cuando concede", async () => {
    const db = fakeDb([{ second_tokens: 78.5, hour_tokens: 21_437 }]);

    const grant = await new QuotaLedger(db, LIMITS).take("batch");

    assert.deepEqual(grant, { granted: true, secondTokens: 78.5, hourTokens: 21_437 });
    assert.equal(db.calls.length, 1, "el camino feliz es un solo viaje");
  });

  it("acepta los números como los devuelve el driver, sean string o no", async () => {
    // `double precision` puede llegar como texto según la configuración del driver.
    const db = fakeDb([{ second_tokens: "78.5", hour_tokens: "21437" }]);

    const grant = await new QuotaLedger(db, LIMITS).take("batch");

    assert.deepEqual(grant, { granted: true, secondTokens: 78.5, hourTokens: 21_437 });
  });

  it("al denegar por el bucket horario, espera lo que tarda en entrar la ficha que falta", async () => {
    // Cero filas actualizadas = denegado. `aggregate` necesita 2.001 fichas y
    // hay 2.000: falta una, que a 32.000/h entra en 0,1125 s.
    const db = fakeDb([], [{ second_tokens: 80, hour_tokens: 2_000, idle_seconds: 0 }]);

    const grant = await new QuotaLedger(db, LIMITS).take("aggregate");

    assert.equal(grant.granted, false);
    assert.equal(grant.granted === false && grant.retryAfterMs, Math.ceil(1000 / HOUR_RATE));
    assert.equal(db.calls.length, 2, "el segundo viaje solo se paga al denegar");
  });

  it("cuenta el rellenado transcurrido desde el último descuento", async () => {
    // Faltan 2 fichas pero han pasado 0,1125 s: ya ha entrado una, así que la
    // espera es la mitad de la que sería si el reloj no contase.
    const db = fakeDb([], [{ second_tokens: 80, hour_tokens: 1_999, idle_seconds: 1 / HOUR_RATE }]);

    const grant = await new QuotaLedger(db, LIMITS).take("aggregate");

    assert.equal(grant.granted === false && grant.retryAfterMs, Math.ceil(1000 / HOUR_RATE));
  });

  it("al denegar por el bucket por segundo, la espera es la del bucket por segundo", async () => {
    // Cuota horaria de sobra, pero el segundo está seco: 80 fichas/s significa
    // que la siguiente entra en 12,5 ms — por debajo del suelo de reintento.
    const db = fakeDb([], [{ second_tokens: 0, hour_tokens: 31_000, idle_seconds: 0 }]);

    const grant = await new QuotaLedger(db, LIMITS).take("on-demand");

    assert.equal(grant.granted === false && grant.retryAfterMs, 25, "suelo de reintento");
  });

  it("manda parar si la base no está migrada", async () => {
    // Denegado y sin fila: seguir sería llamar a Blizzard sin contar nada.
    const db = fakeDb([], []);

    await assert.rejects(() => new QuotaLedger(db, LIMITS).take("batch"), /db:migrate/);
  });
});

describe("token compartido", () => {
  it("no devuelve nada si todavía no hay token guardado", async () => {
    const db = fakeDb([{ access_token: null, token_expires_at: null }]);

    assert.equal(await readSharedToken(db), null);
  });

  it("solo pisa el token guardado si el nuevo dura más", async () => {
    // Es lo que hace inofensiva una estampida de arranques en frío: gana el que
    // más vida deja, no el último en escribir.
    const db = fakeDb([]);
    const expiresAt = new Date("2026-09-01T12:00:00.000Z");

    await writeSharedToken(db, { value: "abc", expiresAt });

    assert.match(db.calls[0]?.text ?? "", /token_expires_at is null or token_expires_at < \$2/);
    assert.deepEqual(db.calls[0]?.values, ["abc", expiresAt.toISOString()]);
  });
});
