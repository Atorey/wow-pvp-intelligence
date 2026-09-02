import type { QuotaBudget } from "./quota";

export interface Clock {
  now(): number;
  sleep(ms: number): Promise<void>;
}

const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Prioridades de §28 del plan, de más urgente a menos:
 * refresco bajo demanda de usuario > batch de leaderboard > recomputo de agregados.
 *
 * El orden no es una preferencia estética: hay un humano esperando delante de una
 * pantalla solo en el primer caso. Los otros dos pueden llegar tarde sin que nadie
 * lo note, porque su salida se consume después.
 */
export type RequestPriority = "on-demand" | "batch" | "aggregate";

export const PRIORITIES: readonly RequestPriority[] = ["on-demand", "batch", "aggregate"];

const PRIORITY_RANK: Record<RequestPriority, number> = {
  "on-demand": 0,
  batch: 1,
  aggregate: 2,
};

/**
 * Lo que devuelve pedir turno. No lanza: `tryGet` trata las excepciones como
 * fallo de red y las reintentaría, que es justo lo contrario de lo que hay que
 * hacer cuando no queda cuota o se acabó el tiempo.
 */
export type AcquireResult =
  { ok: true } | { ok: false; reason: "quota" | "deadline"; retryAfterMs: number };

export interface RequestQueueOptions {
  requestsPerSecond: number;
  /**
   * Quien concede de verdad (ADR 0013, decisión 6). La cola ordena y espacia,
   * pero el permiso lo da el presupuesto compartido: es obligatorio porque
   * hacerlo opcional reintroduciría el "concede por su cuenta" que el ADR
   * elimina.
   */
  budget: QuotaBudget;
  clock?: Clock;
  /**
   * Aviso de que el presupuesto compartido ha denegado. Sin esto, quedarse sin
   * cuota se ve desde fuera igual que un job colgado.
   */
  onQuotaWait?: (waitMs: number, pending: number, priority: RequestPriority) => void;
}

export interface QueueUsage {
  granted: Record<RequestPriority, number>;
  total: number;
  /** Fichas que quedaban en el bucket horario la última vez que se pidió una; `null` si no se pidió ninguna. */
  hourTokensLeft: number | null;
  hourCapacity: number;
  /** Veces que el presupuesto compartido denegó, y cuánto sumaron esas esperas. */
  quotaWaits: number;
  quotaWaitMs: number;
  /** Turnos abandonados porque se agotó el presupuesto de tiempo de quien esperaba. */
  deadlineDrops: number;
}

interface Waiter {
  priority: RequestPriority;
  rank: number;
  /** Orden de llegada: desempata dentro de la misma prioridad (FIFO). */
  seq: number;
  /** Instante en que dejar de intentarlo. `Infinity` para quien no tiene a nadie esperando. */
  deadlineAt: number;
  resolve: (result: AcquireResult) => void;
}

/**
 * Cola con throttling explícito y priorización (docs/product-plan.md §28,
 * ADR 0005), sobre el presupuesto compartido del ADR 0013.
 *
 * Lo que hace, y solo lo que solo ella puede hacer:
 *
 * - **Espaciar** las peticiones de **este** proceso a un ritmo fijo por diseño,
 *   no disparando a tope y reaccionando a los 429 — cuando llega un 429 la
 *   cuota ya está gastada.
 * - **Ordenar** las peticiones que compiten por el mismo turno. Es donde el
 *   pipeline tiene miles que ordenar, y no se puede hacer en la base de datos.
 *
 * Lo que ya **no** hace es llevar la cuenta del presupuesto horario. Eso vive en
 * Postgres desde el ADR 0013, porque la cuenta en memoria solo era correcta
 * mientras un proceso poseyera la cuota entera, y con la web en serverless deja
 * de serlo. Aquí no queda una ventana horaria "por si acaso": sería un segundo
 * techo contando lo mismo con distinto resultado.
 *
 * Los turnos los reparte un único bucle (`pump`), no cada llamante por su
 * cuenta. Es lo que hace posible la prioridad: cuando llega el turno se elige al
 * mejor candidato **de los que hay en ese momento**, así que una petición
 * urgente que aparece mientras la cola espera adelanta a las que ya estaban.
 */
export class RequestQueue {
  private readonly intervalMs: number;
  private readonly clock: Clock;
  private readonly budget: QuotaBudget;
  private readonly onQuotaWait:
    ((waitMs: number, pending: number, priority: RequestPriority) => void) | undefined;

  private nextSlotAt = 0;
  private waiters: Waiter[] = [];
  private seq = 0;
  private pumping = false;

  /**
   * Hasta cuándo cada prioridad tiene denegada la ficha.
   *
   * Es por clase y no global porque la reserva del ADR 0013 no significaría
   * nada si una denegación a `batch` parase también a `on-demand`: el colchón
   * existe justo para que lo urgente siga pasando cuando el trabajo de fondo ya
   * no puede.
   */
  private readonly blockedUntil: Record<RequestPriority, number> = {
    "on-demand": 0,
    batch: 0,
    aggregate: 0,
  };

  private readonly granted: Record<RequestPriority, number> = {
    "on-demand": 0,
    batch: 0,
    aggregate: 0,
  };
  private hourTokensLeft: number | null = null;
  private quotaWaits = 0;
  private quotaWaitMs = 0;
  private deadlineDrops = 0;

  constructor({ requestsPerSecond, budget, clock = realClock, onQuotaWait }: RequestQueueOptions) {
    if (requestsPerSecond <= 0) throw new Error("requestsPerSecond debe ser > 0");
    this.intervalMs = 1000 / requestsPerSecond;
    this.clock = clock;
    this.budget = budget;
    this.onQuotaWait = onQuotaWait;
  }

  /**
   * Reserva un turno. Resuelve cuando toca hacer la petición, no antes.
   *
   * `deadlineAt` es el instante a partir del cual ya no merece la pena: lo pasa
   * quien tiene a un humano esperando (ADR 0013, decisión 7). Sin él se espera
   * lo que haga falta, que es lo correcto para el batch.
   */
  acquire(priority: RequestPriority, deadlineAt = Infinity): Promise<AcquireResult> {
    return new Promise<AcquireResult>((resolve) => {
      this.waiters.push({
        priority,
        rank: PRIORITY_RANK[priority],
        seq: this.seq++,
        deadlineAt,
        resolve,
      });
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
    return {
      granted: { ...this.granted },
      total: this.granted["on-demand"] + this.granted.batch + this.granted.aggregate,
      hourTokensLeft: this.hourTokensLeft,
      hourCapacity: this.budget.limits.hourCapacity,
      quotaWaits: this.quotaWaits,
      quotaWaitMs: this.quotaWaitMs,
      deadlineDrops: this.deadlineDrops,
    };
  }

  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;

    try {
      while (this.waiters.length > 0) {
        const now = this.clock.now();

        // Los que ya no llegan a tiempo salen antes de gastar nada en ellos.
        if (this.dropExpired(now)) continue;

        const index = this.pickIndex(now);
        const target = index === -1 ? this.earliestUnblock() : this.nextSlotAt;

        if (target > now) {
          await this.sleepBounded(target, now);
          // Se reevalúa en vez de conceder a ciegas: durante la espera puede
          // haber entrado una petición más urgente, o un 429 puede haber movido
          // el turno.
          continue;
        }
        if (index === -1) continue;

        const waiter = this.waiters[index] as Waiter;

        // El viaje a Postgres va dentro del bucle, así que serializa las
        // peticiones del proceso. Cabe de sobra: al ritmo configurado el
        // espaciado son ~125 ms y el descuento son unos pocos.
        const grant = await this.budget.take(waiter.priority);

        if (!grant.granted) {
          this.hourTokensLeft = grant.hourTokens;
          this.blockedUntil[waiter.priority] = this.clock.now() + grant.retryAfterMs;
          this.quotaWaits++;
          this.quotaWaitMs += grant.retryAfterMs;
          this.onQuotaWait?.(grant.retryAfterMs, this.waiters.length, waiter.priority);
          // El que ha sido denegado no se consume: vuelve a competir cuando su
          // clase se desbloquee, y mientras tanto pasa quien sí tenga permiso.
          continue;
        }

        this.waiters.splice(index, 1);
        this.hourTokensLeft = grant.hourTokens;
        this.nextSlotAt = this.clock.now() + this.intervalMs;
        this.granted[waiter.priority]++;
        waiter.resolve({ ok: true });
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Resuelve a los que se han quedado sin tiempo. Devuelve si ha sacado a alguno. */
  private dropExpired(now: number): boolean {
    const expired = this.waiters.filter((w) => w.deadlineAt <= now);
    if (expired.length === 0) return false;

    this.waiters = this.waiters.filter((w) => w.deadlineAt > now);
    for (const waiter of expired) {
      this.deadlineDrops++;
      waiter.resolve({
        ok: false,
        reason: "deadline",
        retryAfterMs: Math.max(0, this.blockedUntil[waiter.priority] - now),
      });
    }
    return true;
  }

  /**
   * El de mayor prioridad entre los que pueden pedir ficha ahora; a igual
   * prioridad, el que lleva más tiempo esperando. `-1` si todos los que hay
   * pertenecen a clases denegadas.
   */
  private pickIndex(now: number): number {
    let best = -1;
    for (let i = 0; i < this.waiters.length; i++) {
      const candidate = this.waiters[i] as Waiter;
      if (this.blockedUntil[candidate.priority] > now) continue;
      if (best === -1) {
        best = i;
        continue;
      }
      const current = this.waiters[best] as Waiter;
      if (
        candidate.rank < current.rank ||
        (candidate.rank === current.rank && candidate.seq < current.seq)
      ) {
        best = i;
      }
    }
    return best;
  }

  /** El desbloqueo más temprano entre las clases que tienen a alguien esperando. */
  private earliestUnblock(): number {
    let earliest = Infinity;
    for (const waiter of this.waiters) {
      earliest = Math.min(earliest, this.blockedUntil[waiter.priority]);
    }
    return earliest;
  }

  /**
   * Duerme hasta `target`, pero nunca más allá del primer presupuesto de tiempo
   * que venza: quien tiene un humano delante debe recibir su negativa a la hora
   * que dijo, no cuando la cuota se digne a volver.
   */
  private async sleepBounded(target: number, now: number): Promise<void> {
    let until = target;
    for (const waiter of this.waiters) {
      until = Math.min(until, waiter.deadlineAt);
    }
    await this.clock.sleep(Math.max(0, until - now));
  }
}

/** Resumen de una línea del gasto de cuota, para el final de cada job. */
export function formatUsage(usage: QueueUsage): string {
  const byPriority = PRIORITIES.filter((p) => usage.granted[p] > 0)
    .map((p) => `${p} ${usage.granted[p]}`)
    .join(", ");

  const parts = [`${usage.total} peticiones (${byPriority || "ninguna"})`];

  if (usage.hourTokensLeft !== null) {
    const pct = Math.round((usage.hourTokensLeft / usage.hourCapacity) * 100);
    parts.push(
      `quedan ${Math.floor(usage.hourTokensLeft)}/${usage.hourCapacity} ` +
        `del bucket horario compartido (${pct}%)`,
    );
  }
  if (usage.quotaWaits > 0) {
    parts.push(
      `${usage.quotaWaits} espera(s) por cuota, ${Math.round(usage.quotaWaitMs / 1000)}s en total`,
    );
  }
  if (usage.deadlineDrops > 0) {
    parts.push(`${usage.deadlineDrops} descartada(s) por presupuesto de tiempo`);
  }
  return parts.join(" · ");
}
