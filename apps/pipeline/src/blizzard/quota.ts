import type { Queryable } from "@wowpvp/data";
import type { RequestPriority } from "./request-queue";

const SECONDS_PER_HOUR = 3_600;

/**
 * Suelo de la espera al denegar. Sin él, una denegación que coincide con el
 * instante exacto en que entra una ficha devolvería 0 y la cola giraría a
 * base de viajes a la base de datos.
 */
const MIN_RETRY_MS = 25;

export interface QuotaLimits {
  /** Capacidad del bucket por segundo. El límite real de Blizzard es 100/s por client ID. */
  secondCapacity: number;
  /** Capacidad del bucket horario y techo global del proyecto. Real: 36.000/h. */
  hourCapacity: number;
  /** Fichas del bucket horario que solo `on-demand` puede gastar (ADR 0013, decisión 5). */
  onDemandReserve: number;
}

export type QuotaGrant =
  | { granted: true; secondTokens: number; hourTokens: number }
  | { granted: false; retryAfterMs: number; hourTokens: number };

/**
 * El permiso para llamar a Blizzard, mirado desde la cola. Es una interfaz y no
 * la clase directamente para que los tests de espaciado y prioridad de
 * `RequestQueue` no necesiten una Postgres delante.
 */
export interface QuotaBudget {
  take(priority: RequestPriority): Promise<QuotaGrant>;
  readonly limits: QuotaLimits;
}

/**
 * Descuenta una ficha y devuelve lo que queda, o no descuenta nada.
 *
 * Las expresiones están repetidas entre el `set` y el `where`, y no es
 * descuido: es lo que hace correcto el descuento cuando dos procesos compiten.
 * Cuando el segundo llega a una fila que el primero acaba de actualizar,
 * Postgres reevalúa el `where` contra la versión nueva (EvalPlanQual), pero esa
 * reevaluación solo alcanza a las columnas de la fila objetivo. Un CTE que
 * precalculase los valores se quedaría con el snapshot anterior, y el perdedor
 * de la carrera gastaría fichas que el ganador ya se había llevado.
 *
 * `clock_timestamp()` y no `now()`: `now()` es la hora de inicio de la
 * transacción, así que dentro de una transacción larga el rellenado se
 * congelaría y la cuota dejaría de recargarse sin que nada fallase.
 */
const TAKE_SQL = `
  update blizzard_quota set
    second_tokens = least($1::float8, second_tokens + extract(epoch from (clock_timestamp() - updated_at)) * $2::float8) - 1,
    hour_tokens   = least($3::float8, hour_tokens   + extract(epoch from (clock_timestamp() - updated_at)) * $4::float8) - 1,
    updated_at    = clock_timestamp()
  where id = 1
    and least($1::float8, second_tokens + extract(epoch from (clock_timestamp() - updated_at)) * $2::float8) >= 1
    and least($3::float8, hour_tokens   + extract(epoch from (clock_timestamp() - updated_at)) * $4::float8) >= 1 + $5::float8
  returning second_tokens, hour_tokens
`;

/** Solo se lee al denegar, para saber cuánto esperar. En el camino feliz no se paga. */
const STATE_SQL = `
  select
    second_tokens,
    hour_tokens,
    extract(epoch from (clock_timestamp() - updated_at)) as idle_seconds
  from blizzard_quota
  where id = 1
`;

interface TakeRow {
  second_tokens: string | number;
  hour_tokens: string | number;
}

interface StateRow extends TakeRow {
  idle_seconds: string | number;
}

/** `double precision` puede llegar como string según el driver; el resto del módulo trabaja con números. */
function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

/**
 * El presupuesto de cuota compartido, en Postgres (ADR 0013, decisión 3).
 *
 * Recibe el ejecutor y no lo crea, por la misma razón que `packages/data`: el
 * pipeline es un proceso largo al que le conviene un pool y la web es una
 * invocación efímera que habla por el pooler en modo transacción. Si esta clase
 * abriera la conexión, elegiría por sus dos consumidores.
 *
 * Token bucket y no ventana fija: una ventana horaria permite gastar el
 * presupuesto entero al final de una hora y otro entero al principio de la
 * siguiente —48.000 peticiones en sesenta minutos reales— sin que ningún
 * contador proteste. El bucket se rellena a tasa constante y no tiene bordes.
 */
export class QuotaLedger implements QuotaBudget {
  readonly limits: QuotaLimits;
  private readonly db: Queryable;
  /** Fichas por segundo de cada bucket: llenar el bucket por segundo cuesta 1 s; el horario, 1 h. */
  private readonly secondRate: number;
  private readonly hourRate: number;

  constructor(db: Queryable, limits: QuotaLimits) {
    if (limits.secondCapacity <= 0) throw new Error("secondCapacity debe ser > 0");
    if (limits.hourCapacity <= 0) throw new Error("hourCapacity debe ser > 0");
    if (limits.onDemandReserve < 0) throw new Error("onDemandReserve no puede ser negativo");
    // Con la reserva por encima del techo, `batch` y `aggregate` no podrían
    // conseguir ficha nunca y el pipeline se quedaría esperando una hora que no
    // llega. Es un error de configuración, y falla al construir en vez de a las
    // tres de la mañana en el job programado.
    if (limits.onDemandReserve + 1 > limits.hourCapacity) {
      throw new Error(
        `BLIZZARD_ON_DEMAND_RESERVE (${limits.onDemandReserve}) no deja ninguna ficha por ` +
          `encima del techo horario (${limits.hourCapacity}): el trabajo de fondo nunca podría ` +
          `pedir permiso.`,
      );
    }

    this.db = db;
    this.limits = limits;
    this.secondRate = limits.secondCapacity;
    this.hourRate = limits.hourCapacity / SECONDS_PER_HOUR;
  }

  /**
   * Pide una ficha. `on-demand` gasta hasta la última; `batch` y `aggregate`
   * solo por encima del colchón reservado.
   */
  async take(priority: RequestPriority): Promise<QuotaGrant> {
    const reserve = this.reserveFor(priority);

    const taken = await this.db.query<TakeRow>(TAKE_SQL, [
      this.limits.secondCapacity,
      this.secondRate,
      this.limits.hourCapacity,
      this.hourRate,
      reserve,
    ]);

    const row = taken.rows[0];
    if (row) {
      return {
        granted: true,
        secondTokens: num(row.second_tokens),
        hourTokens: num(row.hour_tokens),
      };
    }

    return this.denial(reserve);
  }

  /**
   * `on-demand` es el único que ve el bucket entero: es el que tiene a alguien
   * esperando delante de una pantalla.
   */
  private reserveFor(priority: RequestPriority): number {
    return priority === "on-demand" ? 0 : this.limits.onDemandReserve;
  }

  /**
   * Cuánto falta para que haya ficha. Se calcula aquí y no en SQL porque es
   * aritmética pura: así se prueba sin una base de datos delante, que es donde
   * un signo cambiado se ve.
   */
  private async denial(reserve: number): Promise<QuotaGrant> {
    const state = (await this.db.query<StateRow>(STATE_SQL)).rows[0];
    if (!state) {
      // La fila la crea la migración. Si no está, la base no está migrada y
      // seguir adelante sería llamar a Blizzard sin contar nada.
      throw new Error(
        "No existe la fila de blizzard_quota. Ejecuta `npm run db:migrate` antes de llamar a la API.",
      );
    }

    const idle = num(state.idle_seconds);
    const second = Math.min(
      this.limits.secondCapacity,
      num(state.second_tokens) + idle * this.secondRate,
    );
    const hour = Math.min(this.limits.hourCapacity, num(state.hour_tokens) + idle * this.hourRate);

    const waitSeconds = Math.max(
      second >= 1 ? 0 : (1 - second) / this.secondRate,
      hour >= 1 + reserve ? 0 : (1 + reserve - hour) / this.hourRate,
    );

    return {
      granted: false,
      retryAfterMs: Math.max(MIN_RETRY_MS, Math.ceil(waitSeconds * 1000)),
      hourTokens: hour,
    };
  }
}

// -- Token de OAuth --------------------------------------------------------
//
// Comparte tabla con los buckets (ADR 0013, decisión 8) y también módulo,
// porque comparten la pregunta: es estado que no puede vivir en la memoria de
// un proceso. En uno encendido, cachear el token en el objeto es una petición
// cada 24 h; en serverless es una por arranque en frío, y ninguna la cuenta
// nadie.

export interface SharedToken {
  value: string;
  expiresAt: Date;
}

/** El token guardado, o `null` si no hay ninguno. Que esté caducado lo decide quien llama. */
export async function readSharedToken(db: Queryable): Promise<SharedToken | null> {
  const row = (
    await db.query<{ access_token: string | null; token_expires_at: Date | null }>(
      "select access_token, token_expires_at from blizzard_quota where id = 1",
    )
  ).rows[0];

  if (!row?.access_token || !row.token_expires_at) return null;
  return { value: row.access_token, expiresAt: row.token_expires_at };
}

/**
 * Guarda el token recién pedido, salvo que el que hay dure más.
 *
 * La condición es lo que hace inofensiva una estampida de arranques en frío:
 * varios procesos pueden pedir token a la vez —una ficha cada uno, que es
 * barato— y el que gana es el que más vida deja, no el último en escribir. No
 * se coge un advisory lock por esto: cambiaría un coste ridículo por un modo de
 * fallo nuevo, el del proceso que se muere con el lock en la mano.
 */
export async function writeSharedToken(db: Queryable, token: SharedToken): Promise<void> {
  await db.query(
    `update blizzard_quota
        set access_token = $1, token_expires_at = $2
      where id = 1
        and (token_expires_at is null or token_expires_at < $2)`,
    [token.value, token.expiresAt.toISOString()],
  );
}
