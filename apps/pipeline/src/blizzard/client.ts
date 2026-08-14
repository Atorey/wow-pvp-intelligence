import { getBlizzardCredentials, getRegion, getRequestsPerSecond } from "../config";
import { RateLimiter } from "./rate-limiter";

export type Namespace = "profile" | "dynamic" | "static";

export interface BlizzardResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T | null;
  error?: string;
}

const TOKEN_URL = "https://oauth.battle.net/token";

/** Códigos que merecen reintento: cuota agotada o fallo transitorio del lado de Blizzard. */
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

export interface BlizzardClientOptions {
  maxRetries?: number;
  locale?: string;
}

/**
 * Cliente de la API de Blizzard con flujo client credentials.
 *
 * Es el único punto del proyecto que habla con Blizzard: token cacheado,
 * throttling explícito (ver RateLimiter) y reintentos con backoff. Cualquier job
 * nuevo debe pasar por aquí en vez de llamar a fetch por su cuenta — si no, el
 * ritmo global deja de estar controlado.
 */
export class BlizzardClient {
  readonly region: string;
  private readonly host: string;
  private readonly limiter: RateLimiter;
  private readonly maxRetries: number;
  private readonly locale: string;
  private token: { value: string; expiresAt: number } | null = null;

  constructor(options: BlizzardClientOptions = {}) {
    this.region = getRegion();
    this.host = `https://${this.region}.api.blizzard.com`;
    this.limiter = new RateLimiter(getRequestsPerSecond());
    this.maxRetries = options.maxRetries ?? 3;
    this.locale = options.locale ?? "en_GB";
  }

  private async getAccessToken(): Promise<string> {
    if (this.token && this.token.expiresAt > Date.now() + 30_000) {
      return this.token.value;
    }

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
    this.token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
    return this.token.value;
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
      await this.limiter.acquire();

      try {
        const token = await this.getAccessToken();
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });

        if (res.ok) {
          return { ok: true, status: res.status, data: (await res.json()) as T };
        }

        last = { ok: false, status: res.status, data: null, error: await res.text() };

        if (!RETRYABLE_STATUS.has(res.status)) return last;

        // Blizzard puede decir cuánto esperar; si no lo dice, backoff exponencial.
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
        this.limiter.pauseFor(waitMs);
      } catch (err) {
        // Fallo de red: también es reintentable.
        last = {
          ok: false,
          status: 0,
          data: null,
          error: err instanceof Error ? err.message : String(err),
        };
        this.limiter.pauseFor(500 * 2 ** attempt);
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
