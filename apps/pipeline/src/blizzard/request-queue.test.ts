import assert from "node:assert/strict";
import { test } from "node:test";
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

function queue(clock: Clock, requestsPerSecond = 10, requestsPerHour = 1_000): RequestQueue {
  return new RequestQueue({ requestsPerSecond, requestsPerHour, clock });
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

test("el presupuesto horario frena aunque el ritmo por segundo sea correcto", async () => {
  const clock = fakeClock();
  // 1 cada ms: el techo instantáneo no molesta, solo el horario.
  const q = queue(clock, 1_000, 3);

  await q.acquire("batch");
  await q.acquire("batch");
  await q.acquire("batch");
  assert.equal(clock.elapsed, 2, "las tres primeras solo pagan el espaciado");

  await q.acquire("batch");
  assert.equal(clock.elapsed, 3_600_000, "la cuarta espera a que la primera salga de la ventana");
  assert.equal(q.usage().budgetWaits, 1);
});

test("la ventana es deslizante: lo caducado libera hueco", async () => {
  const clock = fakeClock();
  const q = queue(clock, 1_000, 2);

  await q.acquire("batch");
  await q.acquire("batch");
  clock.elapsed += 3_600_000; // pasa una hora sin pedir nada

  await q.acquire("batch");
  assert.equal(q.usage().budgetWaits, 0, "no debería haber esperado por cuota");
  assert.equal(q.usage().inWindow, 1, "las dos anteriores ya no cuentan");
});

test("avisa cuando la cuota bloquea la cola", async () => {
  const clock = fakeClock();
  const avisos: number[] = [];
  const q = new RequestQueue({
    requestsPerSecond: 1_000,
    requestsPerHour: 1,
    clock,
    onBudgetWait: (waitMs) => avisos.push(waitMs),
  });

  await q.acquire("batch");
  await q.acquire("batch");

  assert.deepEqual(avisos, [3_600_000]);
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
  assert.equal(usage.inWindow, 3);
  assert.match(formatUsage(usage), /3 peticiones \(batch 2, aggregate 1\)/);
});

test("rechaza límites imposibles", () => {
  const clock = fakeClock();
  assert.throws(() => queue(clock, 0), /requestsPerSecond/);
  assert.throws(() => queue(clock, 10, 0), /requestsPerHour/);
});
