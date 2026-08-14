export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Throttling explícito, no reactivo (docs/product-plan.md §28).
 *
 * El límite documentado de Blizzard es 100 req/s y 36.000 req/h por client ID.
 * El que muerde de verdad es el horario: 36.000/h ≈ 10 req/s sostenidos. Por eso
 * espaciamos las peticiones a un ritmo fijo por diseño en vez de disparar a tope
 * y reaccionar a los 429 — cuando llega un 429 ya has gastado tu cuota.
 *
 * Reserva turnos: varios llamantes en paralelo se reparten huecos consecutivos,
 * así que el ritmo global se respeta aunque haya concurrencia.
 */
export class RateLimiter {
  private nextSlotAt = 0;
  private readonly intervalMs: number;

  constructor(
    requestsPerSecond: number,
    private readonly clock: Clock = realClock,
  ) {
    if (requestsPerSecond <= 0) throw new Error("requestsPerSecond debe ser > 0");
    this.intervalMs = 1000 / requestsPerSecond;
  }

  async acquire(): Promise<void> {
    const now = this.clock.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.intervalMs;
    const waitMs = slot - now;
    if (waitMs > 0) await this.clock.sleep(waitMs);
  }

  /** Empuja todos los turnos futuros: se usa al recibir un 429 con Retry-After. */
  pauseFor(ms: number): void {
    this.nextSlotAt = Math.max(this.nextSlotAt, this.clock.now() + ms);
  }
}
