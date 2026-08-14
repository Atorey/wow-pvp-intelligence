import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Region } from "@wowpvp/core";

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

const VALID_REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];

function required(name: string, hint: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta ${name} en el .env de la raíz del repo. ${hint}`);
  }
  return value;
}

export function getRegion(): Region {
  const raw = (process.env["BLIZZARD_REGION"] ?? "eu").toLowerCase();
  const region = VALID_REGIONS.find((r) => r === raw);
  if (!region) {
    throw new Error(
      `BLIZZARD_REGION="${raw}" no es válida. Opciones: ${VALID_REGIONS.join(", ")}.`,
    );
  }
  return region;
}

export function getRequestsPerSecond(): number {
  const raw = process.env["BLIZZARD_REQUESTS_PER_SECOND"];
  const parsed = raw ? Number(raw) : 8;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`BLIZZARD_REQUESTS_PER_SECOND="${raw}" no es un número válido.`);
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
