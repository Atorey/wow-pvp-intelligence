import assert from "node:assert/strict";
import { test } from "node:test";
import type { QuotaBudget, QuotaGrant } from "./quota";
import { RequestQueue, formatUsage, type Clock, type RequestPriority } from "./request-queue";

/** Reloj falso: el tiempo solo avanza cuando alguien duerme. */
function fakeClock(): Clock & { elapsed: number } {
  return {
    elapsed: 0,
    now() {
      return this.elapsed;
    },
    async sleep(ms: number) {
      this.elapsed += ms;
    },
  };
}

const HOUR_CAPACITY = 32_000;

/**
 * Presupuesto falso: aquí se prueba lo que la cola sigue decidiendo por su
 * cuenta —espaciado, orden y qué hacer con una negativa—, no la aritmética del
 * bucket, que es de `quota.test.ts` y del test de integración.
 */
function budget(take: (priority: RequestPriority) => QuotaGrant): QuotaBudget {
  return {
    limits: { secondCapacity: 80, hourCapacity: HOUR_CAPACITY, onDemandReserve: 2_000 },
    take: (priority) => Promise.resolve(take(priority)),
  };
}

const granting = (): QuotaGrant => ({ granted: true, secondTokens: 79, hourTokens: 31_999 });

function queue(
  clock: Clock,
  requestsPerSecond = 10,
  take: (priority: RequestPriority) => QuotaGrant = granting,
): RequestQueue {
  return new RequestQueue({ requestsPerSecond, clock, budget: budget(take) });
}

test("espacia las peticiones al ritmo configurado", async () => {
  const clock = fakeClock();
  const q = queue(clock); // 1 cada 100 ms

  await q.acquire("batch");
  assert.equal(clock.elapsed, 0, "la primera no espera");
  await q.acquire("batch");
  await q.acquire("batch");
  assert.equal(clock.elapsed, 200);
});

test("no acumula deuda cuando el llamante ya fue lento", async () => {
  const clock = fakeClock();
  const q = queue(clock);

  await q.acquire("batch");
  clock.elapsed += 5_000; // el job tardó lo suyo procesando
  await q.acquire("batch");
  assert.equal(clock.elapsed, 5_000, "si ya pasó el hueco, se sale sin esperar");
});

test("un 429 empuja los turnos siguientes", async () => {
  const clock = fakeClock();
  const q = queue(clock);

  await q.acquire("batch");
  q.pauseFor(2_000);
  await q.acquire("batch");
  assert.equal(clock.elapsed, 2_000);
});

test("lo urgente adelanta a lo que ya estaba encolado", async () => {
  const clock = fakeClock();
  const q = queue(clock);
  const order: RequestPriority[] = [];
  const track = (p: RequestPriority) => q.acquire(p).then(() => order.push(p));

  // La primera se concede al instante (cola vacía); las otras dos esperan turno
  // y compiten entre ellas, que es donde la prioridad decide algo.
  const pending = [track("batch"), track("aggregate"), track("on-demand")];
  await Promise.all(pending);

  assert.deepEqual(order, ["batch", "on-demand", "aggregate"]);
});

test("a igual prioridad se respeta el orden de llegada", async () => {
  const clock = fakeClock();
  const q = queue(clock);
  const order: number[] = [];
  const track = (id: number) => q.acquire("aggregate").then(() => order.push(id));

  await Promise.all([track(1), track(2), track(3), track(4)]);

  assert.deepEqual(order, [1, 2, 3, 4]);
});

test("una negativa del presupuesto se espera y se reintenta", async () => {
  const clock = fakeClock();
  let calls = 0;
  // 1 cada ms: el espaciado no molesta, solo la negativa.
  const q = queue(clock, 1_000, () =>
    ++calls === 1 ? { granted: false, retryAfterMs: 5_000, hourTokens: 0 } : granting(),
  );

  const turn = await q.acquire("batch");

  assert.deepEqual(turn, { ok: true });
  assert.equal(clock.elapsed, 5_000, "espera exactamente lo que dijo el presupuesto");
  assert.equal(q.usage().quotaWaits, 1);
  assert.equal(q.usage().quotaWaitMs, 5_000);
});

test("avisa cuando el presupuesto compartido deniega", async () => {
  const clock = fakeClock();
  const avisos: Array<[number, RequestPriority]> = [];
  let calls = 0;
  const q = new RequestQueue({
    requestsPerSecond: 1_000,
    clock,
    budget: budget(() =>
      ++calls === 1 ? { granted: false, retryAfterMs: 900, hourTokens: 12 } : granting(),
    ),
    onQuotaWait: (waitMs, _pending, priority) => avisos.push([waitMs, priority]),
  });

  await q.acquire("aggregate");

  assert.deepEqual(avisos, [[900, "aggregate"]]);
});

test("el presupuesto de tiempo se respeta en vez de esperar a la cuota", async () => {
  const clock = fakeClock();
  // Deniega siempre y pide una hora de espera: nadie con un humano delante puede pagarla.
  const q = queue(clock, 1_000, () => ({
    granted: false,
    retryAfterMs: 3_600_000,
    hourTokens: 0,
  }));

  const turn = await q.acquire("on-demand", 8_000);

  assert.equal(turn.ok, false);
  assert.equal(turn.ok === false && turn.reason, "deadline");
  assert.equal(clock.elapsed, 8_000, "responde a la hora que dijo, no cuando vuelva la cuota");
  assert.equal(q.usage().deadlineDrops, 1);
});

test("una negativa a batch no bloquea a on-demand: la reserva sirve para algo", async () => {
  const clock = fakeClock();
  // Lo que hace el colchón del ADR 0013: el bucket deniega al trabajo de fondo
  // y sigue concediendo a quien tiene a alguien esperando.
  const q = queue(clock, 1_000, (priority) =>
    priority === "on-demand"
      ? granting()
      : { granted: false, retryAfterMs: 3_600_000, hourTokens: 1_500 },
  );

  const batchTurn = q.acquire("batch", 10_000);
  const urgent = await q.acquire("on-demand");

  assert.deepEqual(urgent, { ok: true }, "lo urgente pasa aunque el trabajo de fondo no pueda");
  assert.equal((await batchTurn).ok, false, "y el batch acaba rindiéndose por su propio deadline");
});

test("el gasto se contabiliza por prioridad", async () => {
  const clock = fakeClock();
  const q = queue(clock);

  await q.acquire("batch");
  await q.acquire("batch");
  await q.acquire("aggregate");

  const usage = q.usage();
  assert.deepEqual(usage.granted, { "on-demand": 0, batch: 2, aggregate: 1 });
  assert.equal(usage.total, 3);
  assert.equal(usage.hourTokensLeft, 31_999);
  assert.match(formatUsage(usage), /3 peticiones \(batch 2, aggregate 1\)/);
  assert.match(formatUsage(usage), new RegExp(`31999/${HOUR_CAPACITY} del bucket horario`));
});

test("sin haber pedido ninguna ficha no se inventa el estado del bucket", () => {
  const clock = fakeClock();
  const usage = queue(clock).usage();

  assert.equal(usage.hourTokensLeft, null);
  assert.match(formatUsage(usage), /^0 peticiones \(ninguna\)$/);
});

test("rechaza límites imposibles", () => {
  const clock = fakeClock();
  assert.throws(() => queue(clock, 0), /requestsPerSecond/);
});
