import assert from "node:assert/strict";
import { test } from "node:test";
import {
  AGGREGATE_STALE_AFTER_HOURS,
  MIN_AGGREGATE_CACHE_MINUTES,
  aggregateAgeHours,
  aggregateCacheUntil,
  aggregateExpiresAt,
  isAggregateStale,
} from "./freshness";

/** La corrida de agregados de un día cualquiera, a la hora del cron. */
const COMPUTED_AT = new Date("2026-09-08T05:30:00.000Z");

/** Suma horas sin depender del reloj: todo aquí recibe `now` como parámetro. */
function hoursAfter(base: Date, hours: number): Date {
  return new Date(base.getTime() + hours * 60 * 60 * 1000);
}

test("la corrida deja de ser la última palabra un día después", () => {
  assert.deepEqual(aggregateExpiresAt(COMPUTED_AT), new Date("2026-09-09T05:30:00.000Z"));
});

test("un retraso del cron no es una corrida perdida", () => {
  // El cron de Actions no es puntual: si 24 h bastaran para dar la alarma,
  // saltaría media hora tarde cualquier noche y dejaría de leerse.
  assert.equal(isAggregateStale(COMPUTED_AT, hoursAfter(COMPUTED_AT, 25)), false);
  assert.equal(isAggregateStale(COMPUTED_AT, hoursAfter(COMPUTED_AT, 35)), false);
});

test("perder una corrida entera sí lo es", () => {
  assert.equal(
    isAggregateStale(COMPUTED_AT, hoursAfter(COMPUTED_AT, AGGREGATE_STALE_AFTER_HOURS + 1)),
    true,
  );
});

test("una fecha en el futuro no es una corrida vieja", () => {
  // Es desfase de relojes entre el runner y la base, no un job caído. Tratarlo
  // como vejez daría una alarma que no se puede arreglar mirando el pipeline.
  assert.equal(isAggregateStale(COMPUTED_AT, hoursAfter(COMPUTED_AT, -5)), false);
  assert.equal(aggregateAgeHours(COMPUTED_AT, hoursAfter(COMPUTED_AT, -5)), 0);
});

test("con la corrida al día, la caché vale hasta que pueda haber otra", () => {
  const now = hoursAfter(COMPUTED_AT, 6);
  assert.deepEqual(aggregateCacheUntil(COMPUTED_AT, now), aggregateExpiresAt(COMPUTED_AT));
});

test("con la corrida retrasada, la caché no se evapora: cae al suelo", () => {
  // Sin suelo, una corrida vencida haría fallar todas las visitas y la base
  // recibiría la avalancha justo el día que el recálculo está caído.
  const now = hoursAfter(COMPUTED_AT, 240);
  const until = aggregateCacheUntil(COMPUTED_AT, now);
  assert.equal(until.getTime(), now.getTime() + MIN_AGGREGATE_CACHE_MINUTES * 60 * 1000);
});

test("el suelo no guarda un dato más allá de su relevo", () => {
  // Justo antes de expirar quedan segundos, y el suelo los estira a cinco
  // minutos: eso cruza la caducidad, pero no la de la corrida siguiente.
  const now = new Date(aggregateExpiresAt(COMPUTED_AT).getTime() - 1000);
  const until = aggregateCacheUntil(COMPUTED_AT, now);
  assert.ok(until.getTime() < aggregateExpiresAt(COMPUTED_AT).getTime() + 60 * 60 * 1000);
});
