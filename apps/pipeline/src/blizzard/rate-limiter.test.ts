import assert from "node:assert/strict";
import { test } from "node:test";
import { RateLimiter, type Clock } from "./rate-limiter";

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

test("espacia las peticiones al ritmo configurado", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter(10, clock); // 1 cada 100 ms

  await limiter.acquire();
  assert.equal(clock.elapsed, 0, "la primera no espera");
  await limiter.acquire();
  await limiter.acquire();
  assert.equal(clock.elapsed, 200);
});

test("no acumula deuda cuando el llamante ya fue lento", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter(10, clock);

  await limiter.acquire();
  clock.elapsed += 5_000; // el job tardó lo suyo procesando
  await limiter.acquire();
  assert.equal(clock.elapsed, 5_000, "si ya pasó el hueco, se sale sin esperar");
});

test("un 429 empuja los turnos siguientes", async () => {
  const clock = fakeClock();
  const limiter = new RateLimiter(10, clock);

  await limiter.acquire();
  limiter.pauseFor(2_000);
  await limiter.acquire();
  assert.equal(clock.elapsed, 2_000);
});
