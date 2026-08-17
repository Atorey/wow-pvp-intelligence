export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/** Ventana del presupuesto horario. El límite de Blizzard se cuenta por hora, no por día. */
const WINDOW_MS = 3_600_000;

/**
 * Prioridades de §28 del plan, de más urgente a menos:
 * refresco bajo demanda de usuario > batch de leaderboard > recomputo de agregados.
 *
 * El orden no es una preferencia estética: hay un humano esperando delante de una
 * pantalla solo en el primer caso. Los otros dos pueden llegar tarde sin que nadie
 * lo note, porque su salida se consume después.
 */
export type RequestPriority = "on-demand" | "batch" | "aggregate";

const PRIORITY_RANK: Record<RequestPriority, number> = {
  "on-demand": 0,
  batch: 1,
  aggregate: 2,
};

export interface RequestQueueOptions {
  requestsPerSecond: number;
  requestsPerHour: number;
  clock?: Clock;
  /**
   * Aviso de que la ventana horaria ha bloqueado la cola. Sin esto, agotar la
   * cuota se ve desde fuera igual que un job colgado.
   */
  onBudgetWait?: (waitMs: number, pending: number) => void;
}

export interface QueueUsage {
  granted: Record<RequestPriority, number>;
  total: number;
  /** Concedidas dentro de la ventana horaria vigente; es lo que se compara con el techo. */
  inWindow: number;
  requestsPerHour: number;
  /** Veces que la cola se paró por presupuesto agotado, y cuánto sumaron esas paradas. */
  budgetWaits: number;
  budgetWaitMs: number;
}

interface Waiter {
  priority: RequestPriority;
  rank: number;
  /** Orden de llegada: desempata dentro de la misma prioridad (FIFO). */
  seq: number;
  resolve: () => void;
}

/**
 * Cola con throttling explícito y priorización (docs/product-plan.md §28, ADR 0005).
 *
 * Dos techos a la vez, y el segundo es el que muerde de verdad:
 *
 * - **Instantáneo** (100 req/s documentado): se respeta espaciando los turnos a
 *   un ritmo fijo por diseño, no disparando a tope y reaccionando a los 429 —
 *   cuando llega un 429 la cuota ya está gastada.
 * - **Horario** (36.000 req/h): ventana deslizante sobre las peticiones ya
 *   concedidas. Un ritmo instantáneo correcto puede agotar la hora igualmente:
 *   8 req/s sostenidos son 28.800 peticiones en una hora.
 *
 * Los turnos los reparte un único bucle (`pump`), no cada llamante por su cuenta.
 * Es lo que hace posible la prioridad: cuando llega el turno se elige al mejor
 * candidato **de los que hay en ese momento**, así que una petición urgente que
 * aparece mientras la cola espera adelanta a las que ya estaban encoladas.
 *
 * El presupuesto es por proceso, no compartido entre ejecuciones (ADR 0005): dos
 * jobs solapados no se ven, y por eso el techo configurado va por debajo del real.
 */
export class RequestQueue {
  private readonly intervalMs: number;
  private readonly requestsPerHour: number;
  private readonly clock: Clock;
  private readonly onBudgetWait: ((waitMs: number, pending: number) => void) | undefined;

  private nextSlotAt = 0;
  private waiters: Waiter[] = [];
  private seq = 0;
  private pumping = false;

  /** Marcas de las peticiones concedidas; `head` es la primera que sigue en la ventana. */
  private grants: number[] = [];
  private head = 0;

  private readonly granted: Record<RequestPriority, number> = {
    "on-demand": 0,
    batch: 0,
    aggregate: 0,
  };
  private budgetWaits = 0;
  private budgetWaitMs = 0;

  constructor({
    requestsPerSecond,
    requestsPerHour,
    clock = realClock,
    onBudgetWait,
  }: RequestQueueOptions) {
    if (requestsPerSecond <= 0) throw new Error("requestsPerSecond debe ser > 0");
    if (requestsPerHour <= 0) throw new Error("requestsPerHour debe ser > 0");
    this.intervalMs = 1000 / requestsPerSecond;
    this.requestsPerHour = requestsPerHour;
    this.clock = clock;
    this.onBudgetWait = onBudgetWait;
  }

  /** Reserva un turno. Resuelve cuando toca hacer la petición, no antes. */
  acquire(priority: RequestPriority): Promise<void> {
    return new Promise<void>((resolve) => {
      this.waiters.push({ priority, rank: PRIORITY_RANK[priority], seq: this.seq++, resolve });
      void this.pump();
    });
  }

  /**
   * Empuja todos los turnos futuros: se usa al recibir un 429 con Retry-After.
   * Afecta a la cola entera —también a lo urgente— porque el que ha dicho que
   * esperemos es Blizzard, y colarse solo gastaría cuota en otro 429.
   */
  pauseFor(ms: number): void {
    this.nextSlotAt = Math.max(this.nextSlotAt, this.clock.now() + ms);
  }

  usage(): QueueUsage {
    this.dropExpired(this.clock.now());
    return {
      granted: { ...this.granted },
      total: this.granted["on-demand"] + this.granted.batch + this.granted.aggregate,
      inWindow: this.grants.length - this.head,
      requestsPerHour: this.requestsPerHour,
      budgetWaits: this.budgetWaits,
      budgetWaitMs: this.budgetWaitMs,
    };
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;

    try {
      while (this.waiters.length > 0) {
        const now = this.clock.now();
        const freeAt = this.windowFreeAt(now);
        const target = Math.max(this.nextSlotAt, freeAt);

        if (target > now) {
          if (freeAt > now) {
            this.budgetWaits++;
            this.budgetWaitMs += freeAt - now;
            this.onBudgetWait?.(freeAt - now, this.waiters.length);
          }
          await this.clock.sleep(target - now);
          // Se reevalúa en vez de conceder a ciegas: durante la espera puede haber
          // entrado una petición más urgente, o un 429 puede haber movido el turno.
          continue;
        }

        const waiter = this.takeNext();
        this.nextSlotAt = now + this.intervalMs;
        this.grants.push(now);
        this.granted[waiter.priority]++;
        waiter.resolve();
      }
    } finally {
      this.pumping = false;
    }
  }

  /** El de mayor prioridad; a igual prioridad, el que lleva más tiempo esperando. */
  private takeNext(): Waiter {
    let best = 0;
    for (let i = 1; i < this.waiters.length; i++) {
      const candidate = this.waiters[i] as Waiter;
      const current = this.waiters[best] as Waiter;
      if (
        candidate.rank < current.rank ||
        (candidate.rank === current.rank && candidate.seq < current.seq)
      ) {
        best = i;
      }
    }
    return this.waiters.splice(best, 1)[0] as Waiter;
  }

  /** Momento en que vuelve a haber hueco en la ventana horaria (`now` si ya lo hay). */
  private windowFreeAt(now: number): number {
    this.dropExpired(now);
    if (this.grants.length - this.head < this.requestsPerHour) return now;
    return (this.grants[this.head] as number) + WINDOW_MS;
  }

  private dropExpired(now: number): void {
    while (
      this.head < this.grants.length &&
      (this.grants[this.head] as number) + WINDOW_MS <= now
    ) {
      this.head++;
    }
    // Sin compactar, un proceso largo acumularía marcas ya caducadas para siempre.
    if (this.head > 4096) {
      this.grants = this.grants.slice(this.head);
      this.head = 0;
    }
  }
}

/** Resumen de una línea del gasto de cuota, para el final de cada job. */
export function formatUsage(usage: QueueUsage): string {
  const pct = Math.round((usage.inWindow / usage.requestsPerHour) * 100);
  const byPriority = (["on-demand", "batch", "aggregate"] as const)
    .filter((p) => usage.granted[p] > 0)
    .map((p) => `${p} ${usage.granted[p]}`)
    .join(", ");

  const parts = [
    `${usage.total} peticiones (${byPriority || "ninguna"})`,
    `${usage.inWindow}/${usage.requestsPerHour} de la ventana horaria (${pct}%)`,
  ];
  if (usage.budgetWaits > 0) {
    parts.push(
      `${usage.budgetWaits} espera(s) por cuota, ${Math.round(usage.budgetWaitMs / 1000)}s en total`,
    );
  }
  return parts.join(" · ");
}
