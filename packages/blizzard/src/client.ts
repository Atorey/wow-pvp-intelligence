import type { Queryable } from "@wowpvp/data";
import {
  getBlizzardCredentials,
  getGlobalPerSecond,
  getOnDemandReserve,
  getRegion,
  getRequestsPerHour,
  getRequestsPerSecond,
} from "./config";
import { QuotaLedger, readSharedToken, writeSharedToken } from "./quota";
import { RequestQueue, type QueueUsage, type RequestPriority } from "./request-queue";

export type Namespace = "profile" | "dynamic" | "static";

export interface BlizzardResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
  /**
   * Por qué no se llegó a llamar a Blizzard. Distinguirlo de un 404 es lo que
   * permite decirle al jugador "ahora mismo no puedo mirarlo" en vez de "no
   * existe" (ADR 0013, decisión 7; el copy exacto es de #71).
   */
  unavailable?: "quota" | "deadline";
  retryAfterMs?: number;
}

const TOKEN_URL = "https://oauth.battle.net/token";

/** Códigos que merecen reintento: cuota agotada o fallo transitorio del lado de Blizzard. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

/** Margen antes de la expiración: un token que caduca en vuelo es un 401 que nadie espera. */
const TOKEN_MARGIN_MS = 30_000;

export interface BlizzardClientOptions {
  /**
   * Ejecutor de la base de datos donde vive el presupuesto de cuota. Se recibe,
   * no se crea: el pipeline quiere un pool largo y la web un cliente del pooler
   * por invocación (ADR 0013, decisión 10).
   */
  db: Queryable;
  /**
   * Urgencia del trabajo de quien usa este cliente (§28). Un job = una
   * prioridad; por defecto `batch`, que es lo que hace hoy el pipeline.
   */
  priority?: RequestPriority;
  /**
   * Presupuesto de tiempo total, desde que se construye el cliente (ADR 0013,
   * decisión 7). Lo pasa quien tiene a alguien esperando delante de una
   * pantalla y un host que corta a los 10 s; sin él se espera lo que haga
   * falta, que es lo correcto para el batch.
   *
   * Se fija al construir porque en serverless se construye un cliente por
   * invocación, que es exactamente la unidad que hay que acotar.
   */
  timeBudgetMs?: number;
  maxRetries?: number;
  locale?: string;
}

/**
 * Cola compartida por todo el proceso, no una por cliente.
 *
 * Ya no es donde vive la cuota —eso es Postgres desde el ADR 0013— pero sigue
 * siendo lo que permite que la prioridad ordene algo: solo se pueden ordenar
 * peticiones que compiten por el mismo turno.
 */
let sharedQueue: RequestQueue | null = null;
let sharedDb: Queryable | null = null;

function getSharedQueue(db: Queryable): RequestQueue {
  if (sharedQueue && sharedDb !== db) {
    // Dos ejecutores en el mismo proceso serían dos contabilidades del mismo
    // presupuesto: la cola espaciaría con una y descontaría con la otra. Falla
    // aquí en vez de divergir en silencio.
    throw new Error(
      "Un proceso, un ejecutor de cuota: BlizzardClient ya se construyó con otra conexión. " +
        "Pasa el mismo pool a todos los clientes del proceso.",
    );
  }

  sharedQueue ??= new RequestQueue({
    requestsPerSecond: getRequestsPerSecond(),
    budget: new QuotaLedger(db, {
      secondCapacity: getGlobalPerSecond(),
      hourCapacity: getRequestsPerHour(),
      onDemandReserve: getOnDemandReserve(),
    }),
    onQuotaWait: (waitMs, pending, priority) => {
      console.warn(
        `⏳ Sin cuota para ${priority}: la cola espera ${Math.round(waitMs / 1000)}s ` +
          `(${pending} petición(es) pendientes). Ver BLIZZARD_REQUESTS_PER_HOUR y ` +
          `BLIZZARD_ON_DEMAND_RESERVE.`,
      );
    },
  });
  sharedDb = db;
  return sharedQueue;
}

/**
 * Gasto de cuota de todo el proceso. Los jobs lo imprimen al terminar: sin un
 * número al final, "¿cuánta cuota me queda para lanzar otra cosa?" solo se puede
 * responder a ojo.
 */
export function blizzardUsage(): QueueUsage {
  if (sharedQueue) return sharedQueue.usage();
  // Un job puede terminar sin haber llamado a Blizzard (un `--dry-run`, o nada
  // pendiente que hacer). Eso no es un error, es gasto cero.
  return {
    granted: { "on-demand": 0, batch: 0, aggregate: 0 },
    total: 0,
    hourTokensLeft: null,
    hourCapacity: getRequestsPerHour(),
    quotaWaits: 0,
    quotaWaitMs: 0,
    deadlineDrops: 0,
  };
}

type Authorization = { ok: true; token: string } | { ok: false; result: BlizzardResponse<never> };

/**
 * Cliente de la API de Blizzard con flujo client credentials.
 *
 * Es el único punto del proyecto que habla con Blizzard: token compartido, cola
 * con espaciado y prioridades (ver RequestQueue), permiso de cuota en Postgres
 * (ver QuotaLedger) y reintentos con backoff. Cualquier job nuevo debe pasar por
 * aquí en vez de llamar a fetch por su cuenta — si no, el ritmo global deja de
 * estar controlado y el gasto deja de contarse.
 */
export class BlizzardClient {
  readonly region: string;
  readonly priority: RequestPriority;
  private readonly host: string;
  private readonly db: Queryable;
  private readonly queue: RequestQueue;
  private readonly maxRetries: number;
  private readonly locale: string;
  private readonly deadlineAt: number;
  /** Copia local del token compartido: el pipeline hace miles de peticiones y no puede pagar un select por cada una. */
  private token: { value: string; expiresAt: number } | null = null;

  constructor(options: BlizzardClientOptions) {
    this.region = getRegion();
    this.host = `https://${this.region}.api.blizzard.com`;
    this.db = options.db;
    this.queue = getSharedQueue(options.db);
    this.priority = options.priority ?? "batch";
    this.maxRetries = options.maxRetries ?? 3;
    this.locale = options.locale ?? "en_GB";
    this.deadlineAt =
      options.timeBudgetMs === undefined ? Infinity : Date.now() + options.timeBudgetMs;
  }

  /**
   * El token, de la copia local, de la tabla o de Blizzard, en ese orden.
   *
   * La tabla en medio es lo que hace barato el arranque en frío: una invocación
   * nueva encuentra el token que pidió otra y no vuelve a `oauth.battle.net`.
   * Cuando sí hay que pedirlo, la petición gasta ficha como cualquier otra: no
   * está publicado si el endpoint de OAuth cuenta contra los 36.000/h del client
   * ID, y contarla resuelve la pregunta por el lado barato — con el token
   * compartido son ~1 al día.
   */
  private async authorize(): Promise<Authorization> {
    const fresh = (expiresAt: number): boolean => expiresAt > Date.now() + TOKEN_MARGIN_MS;

    if (this.token && fresh(this.token.expiresAt)) {
      return { ok: true, token: this.token.value };
    }

    const stored = await readSharedToken(this.db);
    if (stored && fresh(stored.expiresAt.getTime())) {
      this.token = { value: stored.value, expiresAt: stored.expiresAt.getTime() };
      return { ok: true, token: stored.value };
    }

    const turn = await this.queue.acquire(this.priority, this.deadlineAt);
    if (!turn.ok) return { ok: false, result: unavailable(turn.reason, turn.retryAfterMs) };

    const { clientId, clientSecret } = getBlizzardCredentials();
    const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

    const res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: "grant_type=client_credentials",
    });

    if (!res.ok) {
      throw new Error(
        `No se pudo obtener el access token (HTTP ${res.status}). Revisa client id/secret. ${await res.text()}`,
      );
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = Date.now() + data.expires_in * 1000;
    this.token = { value: data.access_token, expiresAt };
    await writeSharedToken(this.db, { value: data.access_token, expiresAt: new Date(expiresAt) });

    return { ok: true, token: data.access_token };
  }

  /**
   * GET que nunca lanza por un error de la API: devuelve el status para que el
   * llamante decida. Los jobs de validación necesitan distinguir 404 (personaje
   * inexistente) de 500 (problema de Blizzard) sin envolverlo todo en try/catch.
   */
  async tryGet<T = unknown>(path: string, namespace: Namespace): Promise<BlizzardResponse<T>> {
    const url = `${this.host}${path}${path.includes("?") ? "&" : "?"}namespace=${namespace}-${this.region}&locale=${this.locale}`;
    let last: BlizzardResponse<T> = { ok: false, status: 0, data: null, error: "sin intentos" };

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const auth = await this.authorize();
        if (!auth.ok) return auth.result;

        // Cada intento pide su propio turno: un reintento consume cuota igual que
        // una petición nueva, así que contarlo aparte falsearía el presupuesto.
        const turn = await this.queue.acquire(this.priority, this.deadlineAt);
        // Sin cuota o sin tiempo no se reintenta: reintentar es exactamente lo
        // que no hay que hacer cuando el problema es que no queda presupuesto.
        if (!turn.ok) return unavailable(turn.reason, turn.retryAfterMs);

        const res = await fetch(url, { headers: { Authorization: `Bearer ${auth.token}` } });

        if (res.ok) {
          return { ok: true, status: res.status, data: (await res.json()) as T };
        }

        last = { ok: false, status: res.status, data: null, error: await res.text() };

        if (!RETRYABLE_STATUS.has(res.status)) return last;

        // Blizzard puede decir cuánto esperar; si no lo dice, backoff exponencial.
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        this.queue.pauseFor(waitMs);
      } catch (err) {
        // Fallo de red: también es reintentable.
        last = {
          ok: false,
          status: 0,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
        this.queue.pauseFor(500 * 2 ** attempt);
      }
    }

    return last;
  }

  /** GET que lanza si la API no responde OK. Para jobs donde un fallo debe parar el proceso. */
  async get<T = unknown>(path: string, namespace: Namespace): Promise<T> {
    const res = await this.tryGet<T>(path, namespace);
    if (!res.ok || res.data === null) {
      throw new Error(`GET ${path} falló (HTTP ${res.status}): ${res.error?.slice(0, 300) ?? ""}`);
    }
    return res.data;
  }
}

/** La negativa que no es de Blizzard sino nuestra: no había cuota, o no había tiempo. */
function unavailable(reason: "quota" | "deadline", retryAfterMs: number): BlizzardResponse<never> {
  return {
    ok: false,
    status: 0,
    data: null,
    error:
      reason === "quota"
        ? "Sin cuota disponible para llamar a Blizzard"
        : "Se agotó el presupuesto de tiempo antes de conseguir turno",
    unavailable: reason,
    retryAfterMs,
  };
}
