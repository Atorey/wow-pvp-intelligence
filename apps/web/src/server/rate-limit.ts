import type { Queryable } from "@wowpvp/data";
import { bucketKey, clientIp } from "./client-ip";
import { getDb } from "./db";
import { getRateLimitRules, getRateLimitSalt } from "./env";

/**
 * El límite de peticiones por IP de los endpoints abiertos (ADR 0030).
 *
 * Vive en la web y no en un paquete porque no lo comparte nadie:
 * `packages/blizzard` es lo que habla con la API, y esto también protege a
 * `/api/gap-view`, que no habla con ninguna; `packages/data` es la capa de
 * lecturas (ADR 0014) y esto escribe. El precedente exacto de una escritura
 * desde la web es `gap-views.ts`, por la misma razón.
 *
 * La mecánica es la de `QuotaLedger`: token bucket en Postgres, la clase recibe
 * el ejecutor y la aritmética de la espera se hace en JavaScript, que es donde
 * un signo cambiado se ve en un test sin base de datos delante.
 */

/** Suelo de la espera. `Retry-After` es un entero de segundos: por debajo no se distingue nada. */
const MIN_RETRY_MS = 1_000;

export type RateLimitScope = "submit" | "suggest" | "gap-view";

export interface BucketRule {
  /** Capacidad de la ventana obligatoria. */
  shortCapacity: number;
  shortWindowSeconds: number;
  /** La segunda ventana, para los ámbitos que la tienen. */
  longCapacity?: number;
  longWindowSeconds?: number;
}

export type RateLimitRules = Record<RateLimitScope, BucketRule>;

export type RateLimitVerdict = { limited: false } | { limited: true; retryAfterMs: number };

/**
 * Interfaz y no la clase directamente, por lo mismo que `QuotaBudget`: para que
 * lo que llama al límite se pueda probar sin una Postgres delante.
 */
export interface RateLimiter {
  take(scope: RateLimitScope, keyHash: string): Promise<RateLimitVerdict>;
}

/**
 * Descuenta una ficha del cubo de esa clave, o no descuenta nada.
 *
 * Es un `insert ... on conflict` y no un `update` como el de la cuota porque la
 * fila puede no existir: una clave nueva nace en su primera petición con
 * `capacidad - 1` fichas, que es el estado correcto de quien nunca ha gastado.
 * Hacerlo en una sola sentencia es lo que impide que dos peticiones simultáneas
 * de la misma clave se concedan las dos un cubo lleno.
 *
 * Las expresiones de rellenado están repetidas entre el `set` y el `where`, y
 * aquí el motivo no es el del `update` de la cuota. En `on conflict do update`
 * no hay EvalPlanQual: la sesión que choca espera al bloqueo de fila de la que
 * ganó y evalúa el `set` y el `where` contra la versión más reciente confirmada.
 * La conclusión es la misma —las expresiones tienen que mirar la fila objetivo
 * dentro de la propia sentencia, y no hay forma de ligarlas una sola vez—, pero
 * el mecanismo es otro.
 *
 * `excluded` sería un error: es la fila **propuesta**, o sea `capacidad - 1`, y
 * el rellenado necesita el estado guardado.
 *
 * `clock_timestamp()` y no `now()`: `now()` es la hora de inicio de la
 * transacción, así que el rellenado se congelaría dentro de una transacción y la
 * cuenta dejaría de recargarse sin que nada fallase.
 */
const TAKE_SQL = `
  insert into rate_limit_buckets as b (scope, key_hash, short_tokens, long_tokens, updated_at)
  values ($1, $2, $3::float8 - 1, $5::float8 - 1, clock_timestamp())
  on conflict (scope, key_hash) do update set
    short_tokens = least($3::float8,
        b.short_tokens + extract(epoch from (clock_timestamp() - b.updated_at)) * $4::float8) - 1,
    long_tokens = case when $5::float8 is null then null else least($5::float8,
        coalesce(b.long_tokens, $5::float8)
          + extract(epoch from (clock_timestamp() - b.updated_at)) * $6::float8) - 1 end,
    updated_at = clock_timestamp()
  where least($3::float8,
          b.short_tokens + extract(epoch from (clock_timestamp() - b.updated_at)) * $4::float8) >= 1
    and ($5::float8 is null or least($5::float8,
          coalesce(b.long_tokens, $5::float8)
            + extract(epoch from (clock_timestamp() - b.updated_at)) * $6::float8) >= 1)
  returning short_tokens, long_tokens
`;

/** Solo se lee al denegar, para saber cuánto falta. El camino feliz es un viaje. */
const STATE_SQL = `
  select
    short_tokens,
    long_tokens,
    extract(epoch from (clock_timestamp() - updated_at)) as idle_seconds
  from rate_limit_buckets
  where scope = $1 and key_hash = $2
`;

interface StateRow {
  short_tokens: string | number;
  long_tokens: string | number | null;
  idle_seconds: string | number;
}

/** `double precision` puede llegar como string según el driver. */
function num(value: string | number): number {
  return typeof value === "number" ? value : Number(value);
}

export class BucketLimiter implements RateLimiter {
  private readonly db: Queryable;
  private readonly rules: RateLimitRules;

  constructor(db: Queryable, rules: RateLimitRules) {
    for (const [scope, rule] of Object.entries(rules)) {
      // El camino de inserción no pasa por el `where`, así que una capacidad de
      // cero guardaría -1 fichas y **concedería** la primera petición: el valor
      // que alguien escribiría queriendo decir "bloquéalo todo" significaría "no
      // limites la primera". Falla al construir en vez de invertirse en silencio.
      if (!(rule.shortCapacity >= 1)) {
        throw new Error(
          `La capacidad de "${scope}" debe ser >= 1 (recibido: ${rule.shortCapacity})`,
        );
      }
      if (rule.longCapacity !== undefined && !(rule.longCapacity >= 1)) {
        throw new Error(
          `La capacidad larga de "${scope}" debe ser >= 1 (recibido: ${rule.longCapacity})`,
        );
      }
    }

    this.db = db;
    this.rules = rules;
  }

  async take(scope: RateLimitScope, keyHash: string): Promise<RateLimitVerdict> {
    const rule = this.rules[scope];
    const shortRate = rule.shortCapacity / rule.shortWindowSeconds;
    const longRate =
      rule.longCapacity === undefined || rule.longWindowSeconds === undefined
        ? null
        : rule.longCapacity / rule.longWindowSeconds;

    const taken = await this.db.query(TAKE_SQL, [
      scope,
      keyHash,
      rule.shortCapacity,
      shortRate,
      rule.longCapacity ?? null,
      longRate,
    ]);

    if (taken.rows[0]) return { limited: false };
    return this.denial(scope, keyHash, rule, shortRate, longRate);
  }

  private async denial(
    scope: RateLimitScope,
    keyHash: string,
    rule: BucketRule,
    shortRate: number,
    longRate: number | null,
  ): Promise<RateLimitVerdict> {
    const state = (await this.db.query<StateRow>(STATE_SQL, [scope, keyHash])).rows[0];
    // Sin fila no se lanza, al revés que en la cuota: allí una fila ausente
    // significa que la base no está migrada; aquí es normal —la borró un barrido,
    // o una carrera— y significa que el próximo intento la creará llena.
    if (!state) return { limited: true, retryAfterMs: MIN_RETRY_MS };

    const idle = num(state.idle_seconds);
    const short = Math.min(rule.shortCapacity, num(state.short_tokens) + idle * shortRate);
    const long =
      state.long_tokens === null || longRate === null || rule.longCapacity === undefined
        ? null
        : Math.min(rule.longCapacity, num(state.long_tokens) + idle * longRate);

    const waitSeconds = Math.max(
      short >= 1 ? 0 : (1 - short) / shortRate,
      long === null || long >= 1 || longRate === null ? 0 : (1 - long) / longRate,
    );

    return { limited: true, retryAfterMs: Math.max(MIN_RETRY_MS, Math.ceil(waitSeconds * 1000)) };
  }
}

/**
 * Lo que llaman las acciones y los manejadores. `null` significa "sigue".
 *
 * Se rinde ante cualquier fallo, y no es dejadez: el presupuesto de Blizzard
 * vive en la misma Postgres, así que si la base no responde, `QuotaLedger`
 * tampoco concede y no se llega a llamar a la API igualmente. Este límite es la
 * primera puerta, no la única, y negar el servicio entero por una caída parcial
 * costaría más de lo que protege.
 *
 * Sin dirección tampoco se limita. La alternativa —una clave constante para todo
 * el tráfico anónimo— haría que una regresión de cabecera en el hosting no
 * degradase el límite: tumbaría el sitio para todo el mundo a la vez.
 */
export async function checkLimit(
  scope: RateLimitScope,
  headers: Headers,
): Promise<{ retryAfterMs: number } | null> {
  try {
    const ip = clientIp(headers);
    if (!ip) return null;

    const limiter = new BucketLimiter(getDb(), getRateLimitRules());
    const verdict = await limiter.take(scope, bucketKey(scope, ip, getRateLimitSalt()));

    return verdict.limited ? { retryAfterMs: verdict.retryAfterMs } : null;
  } catch (error) {
    console.error("No se pudo comprobar el límite por IP", error);
    return null;
  }
}

/** Lo que va en `Retry-After`, que se mide en segundos enteros. */
export function retryAfterSeconds(retryAfterMs: number): string {
  return String(Math.max(1, Math.ceil(retryAfterMs / 1000)));
}
