import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { REGIONS, type Region, isRegion } from "@wowpvp/core";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del monorepo: apps/pipeline/src → ../../.. */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** El .env vive en la raíz del repo, no en cada app: un único sitio para los secretos. */
dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

/** Datos crudos descargados (gitignored): caché en disco, no fuente de verdad. */
export const DATA_DIR = path.join(REPO_ROOT, "data");
export const LEADERBOARD_DIR = path.join(DATA_DIR, "leaderboard");
/**
 * Perfiles completos descargados, una carpeta por ejecución de sample-profiles.
 * Que el crudo quede en disco es lo que hace reanudable el muestreo: un run
 * cortado a la mitad no vuelve a gastar cuota en lo que ya bajó.
 */
export const PROFILES_DIR = path.join(DATA_DIR, "profiles");
/** Reportes de validación (gitignored). */
export const REPORTS_DIR = path.join(REPO_ROOT, "reports");

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en el .env de la raíz del repo. ${hint}`);
  }
  return value;
}

export function getRegion(): Region {
  const raw = (process.env["BLIZZARD_REGION"] ?? "eu").toLowerCase();
  // La lista es la de `packages/core` porque la región también es un tramo de
  // ruta pública: ingerir una que el sitio no sabe publicar deja datos sin
  // página a la que colgarlos.
  if (!isRegion(raw)) {
    throw new Error(`BLIZZARD_REGION="${raw}" no es válida. Opciones: ${REGIONS.join(", ")}.`);
  }
  return raw;
}

export function getRequestsPerSecond(): number {
  const raw = process.env["BLIZZARD_REQUESTS_PER_SECOND"];
  const parsed = raw ? Number(raw) : 8;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_REQUESTS_PER_SECOND="${raw}" no es un número válido.`);
  }
  return parsed;
}

/**
 * Techo horario de peticiones a Blizzard. El límite real es 36.000/h por client
 * ID; el default va por debajo a propósito porque el presupuesto se lleva por
 * proceso (ADR 0005): dos jobs solapados no se ven entre ellos, así que el
 * margen es lo que evita que la suma se pase del techo real.
 */
export function getRequestsPerHour(): number {
  const raw = process.env["BLIZZARD_REQUESTS_PER_HOUR"];
  const parsed = raw ? Number(raw) : 24_000;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_REQUESTS_PER_HOUR="${raw}" no es un número válido.`);
  }
  return parsed;
}

/**
 * Días que se conservan los JSON descargados de leaderboard. Son caché de
 * depuración, no histórico: el histórico está en Postgres, que es append-only.
 * Sin poda, un job cada 3h llena el disco con datos que ya están ingeridos.
 */
export function getLeaderboardRetentionDays(): number {
  const raw = process.env["LEADERBOARD_RETENTION_DAYS"];
  const parsed = raw ? Number(raw) : 3;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`LEADERBOARD_RETENTION_DAYS="${raw}" no es un número de días válido.`);
  }
  return parsed;
}

/**
 * Minutos que se considera fresco el perfil de un personaje ya consultado.
 *
 * §28 pide caché corta (15-30 min) en el refresco bajo demanda: sin ella,
 * cinco búsquedas seguidas del mismo personaje cuestan cinco veces la cuota y
 * meten cinco snapshots casi idénticos en un histórico append-only, que es la
 * forma más rápida de convertir el moat en ruido. 30 es el extremo alto del
 * rango del plan: el rating de un jugador no cambia entre dos partidas.
 */
export function getCharacterLookupTtlMinutes(): number {
  const raw = process.env["CHARACTER_LOOKUP_TTL_MINUTES"];
  const parsed = raw ? Number(raw) : 30;
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`CHARACTER_LOOKUP_TTL_MINUTES="${raw}" no es un número de minutos válido.`);
  }
  return parsed;
}

export function getBlizzardCredentials(): { clientId: string; clientSecret: string } {
  const hint = "Crea un client en https://develop.battle.net/access (ver apps/pipeline/README.md).";
  return {
    clientId: required("BLIZZARD_CLIENT_ID", hint),
    clientSecret: required("BLIZZARD_CLIENT_SECRET", hint),
  };
}

export function getDatabaseUrl(): string {
  return required(
    "DATABASE_URL",
    "En Supabase: Project Settings → Database → Connection string → URI.",
  );
}
