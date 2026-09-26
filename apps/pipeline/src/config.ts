import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { DEFAULT_ARCHIVE_BUCKET, supabaseUrlFrom, type StorageConfig } from "@wowpvp/storage";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del monorepo: apps/pipeline/src → ../../.. */
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** El .env vive en la raíz del repo, no en cada app: un único sitio para los secretos. */
dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

/**
 * Lo que configura el acceso a Blizzard vive en `@wowpvp/blizzard`, porque la
 * web lo necesita igual y los dos procesos tienen que leer los mismos números.
 * Se re-exporta para que los jobs sigan pidiéndolo a su config de siempre.
 *
 * Cargar el `.env` sí se queda aquí: en Netlify no hay fichero que leer, las
 * variables las pone el sitio. Este módulo es el que garantiza que estén en
 * `process.env` antes de que ningún job llame a uno de estos getters.
 */
export {
  getBlizzardCredentials,
  getCharacterLookupTtlMinutes,
  getGlobalPerSecond,
  getLookupTimeBudgetMs,
  getNotFoundCacheTtlMinutes,
  getOnDemandReserve,
  getRegion,
  getRequestsPerHour,
  getRequestsPerSecond,
} from "@wowpvp/blizzard";

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
 * Presupuesto de peticiones de una corrida de `refresh-profiles` (ADR 0021).
 *
 * Es un tope declarado, no el techo de cuota: a 4 peticiones por personaje son
 * ~1.500 perfiles por corrida, unos 30 minutos al ritmo medido de 3,2 req/s.
 * Existe porque el trabajo pendiente crece con la temporada —en una ladder
 * madura la población se multiplica por seis— y sin tope una corrida diaria
 * pasaría de pedir media hora de runner a agotar la ventana horaria y quedarse
 * esperando cuota que necesita el resto del sistema.
 */
export function getProfileRefreshBudget(): number {
  const raw = process.env["PROFILE_REFRESH_BUDGET"];
  const parsed = raw ? Number(raw) : 6_000;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`PROFILE_REFRESH_BUDGET="${raw}" no es un número de peticiones válido.`);
  }
  return parsed;
}

export function getDatabaseUrl(): string {
  return required(
    "DATABASE_URL",
    "En Supabase: Project Settings → Database → Connection string → URI.",
  );
}

/**
 * Dónde se archiva el histórico frío de `character_snapshots` (ADR 0034).
 *
 * `SUPABASE_URL` es opcional porque la cadena de Postgres ya la lleva dentro; la
 * clave de servicio no, y no tiene sustituto: el bucket es privado.
 */
export function getArchiveStorage(): StorageConfig {
  const url = process.env["SUPABASE_URL"] ?? supabaseUrlFrom(getDatabaseUrl());
  if (!url) {
    throw new Error(
      "Falta SUPABASE_URL en el .env de la raíz del repo, y DATABASE_URL no es de Supabase " +
        "así que no se puede deducir. Es la URL del proyecto: https://<ref>.supabase.co.",
    );
  }

  return {
    url: url.replace(/\/+$/, ""),
    serviceKey: required(
      "SUPABASE_SERVICE_ROLE_KEY",
      "Supabase → Project Settings → API keys → la clave secreta (service_role).",
    ),
    bucket: process.env["ARCHIVE_BUCKET"] || DEFAULT_ARCHIVE_BUCKET,
  };
}
