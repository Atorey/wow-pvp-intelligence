import "dotenv/config";

const CLIENT_ID = process.env.BLIZZARD_CLIENT_ID;
const CLIENT_SECRET = process.env.BLIZZARD_CLIENT_SECRET;
const REGION = process.env.BLIZZARD_REGION || "eu";

if (!CLIENT_ID || !CLIENT_SECRET) {
  throw new Error(
    "Faltan BLIZZARD_CLIENT_ID / BLIZZARD_CLIENT_SECRET en .env. " +
      "Crea un client en https://develop.battle.net/access (ver README.md)."
  );
}

const API_HOST = `https://${REGION}.api.blizzard.com`;
const TOKEN_URL = "https://oauth.battle.net/token";

let cachedToken: { value: string; expiresAt: number } | null = null;

/**
 * Client credentials flow — es el flujo correcto para todo lo que consultamos
 * en Sprint 0 (perfiles públicos, PvP, equipo, especializaciones). No requiere
 * autorización de usuario ni redirect URI real.
 */
async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.value;
  }

  const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");

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
      `No se pudo obtener el access token (${res.status}). Revisa client id/secret. Body: ${await res.text()}`
    );
  }

  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    value: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return cachedToken.value;
}

/** Pequeño throttle — no es crítico para 10-15 personajes, pero es la base
 *  que hay que respetar cuando esto se convierta en el job de ingesta real
 *  (límite documentado: 100 req/s y 36.000 req/h por client, sección 30). */
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BlizzardGetResult {
  ok: boolean;
  status: number;
  data: any | null;
  error?: string;
}

export async function blizzardGet(
  path: string,
  namespace: "profile" | "dynamic" | "static",
  locale = "en_GB"
): Promise<BlizzardGetResult> {
  const token = await getAccessToken();
  const ns = `${namespace}-${REGION}`;
  const url = `${API_HOST}${path}${path.includes("?") ? "&" : "?"}namespace=${ns}&locale=${locale}`;

  await sleep(120); // ~8 req/s, muy por debajo del límite de 100 req/s

  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!res.ok) {
      return { ok: false, status: res.status, data: null, error: await res.text() };
    }

    return { ok: true, status: res.status, data: await res.json() };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message ?? String(err) };
  }
}

export const REGION_IN_USE = REGION;
