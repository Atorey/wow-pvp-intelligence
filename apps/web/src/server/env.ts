import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import type { RateLimitRules } from "./rate-limit";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raíz del monorepo: apps/web/src/server → ../../../.. */
const REPO_ROOT = path.resolve(HERE, "..", "..", "..", "..");

/**
 * Carga el `.env` de la raíz del repo, que es donde vive el único de todo el
 * monorepo (ADR 0001). Next busca el suyo en `apps/web`, así que sin esto
 * `next dev` no vería ni `DATABASE_URL` ni las credenciales de Blizzard.
 *
 * En Netlify no hay fichero que leer y `dotenv` no hace nada: las variables las
 * pone el sitio. Por eso esto no falla si el `.env` no existe — no es un
 * requisito, es la comodidad del desarrollo local.
 *
 * Se importa por su efecto, así que va antes de leer nada del entorno. Cada
 * módulo de servidor que necesite configuración lo importa; los de cliente, no:
 * aquí hay `node:fs` y ningún secreto tiene por qué cruzar al navegador.
 */
dotenv.config({ path: path.join(REPO_ROOT, ".env"), quiet: true });

export function getDatabaseUrl(): string {
  const value = process.env["DATABASE_URL"];
  if (!value) {
    throw new Error(
      "Falta DATABASE_URL. En local, en el .env de la raíz del repo; en Netlify, como " +
        "variable del sitio y con la cadena del pooler en modo transacción (ADR 0013).",
    );
  }
  return value;
}

/**
 * La sal del hash de la dirección IP (ADR 0030, decisión 3).
 *
 * No tiene default, y menos aún uno aleatorio por proceso: en serverless cada
 * arranque en frío estrenaría un espacio de claves y el límite no limitaría
 * nunca, sin que nada fallase. Un limitador apagado en silencio por una variable
 * que nadie puso es el peor desenlace posible, así que falta la variable y falla.
 */
export function getRateLimitSalt(): string {
  const value = process.env["RATE_LIMIT_SALT"];
  if (!value) {
    throw new Error(
      "Falta RATE_LIMIT_SALT. Es el secreto que hace irreversible el hash de la IP del límite " +
        "por peticiones (ADR 0030): genérala con `openssl rand -hex 32` y ponla en el .env de la " +
        "raíz en local y como variable del sitio en Netlify.",
    );
  }
  return value;
}

const MINUTE = 60;
const HOUR = 3_600;

/**
 * Las capacidades del límite por IP.
 *
 * Salen del entorno y no de la base por lo mismo que las de la cuota de
 * Blizzard: su sitio es la configuración del proceso, y tenerlas en los dos
 * lados obligaría a decidir cuál manda.
 *
 * Los envíos llevan dos ventanas porque son las que gastan cuota: la corta es la
 * ráfaga —quien consulta a varios compañeros seguidos— y la larga es el régimen
 * sostenido, que a 60/h es una búsqueda por minuto.
 */
export function getRateLimitRules(): RateLimitRules {
  return {
    submit: {
      shortCapacity: positive("RATE_LIMIT_SUBMIT_PER_MINUTE", 5),
      shortWindowSeconds: MINUTE,
      longCapacity: positive("RATE_LIMIT_SUBMIT_PER_HOUR", 60),
      longWindowSeconds: HOUR,
    },
    suggest: {
      shortCapacity: positive("RATE_LIMIT_SUGGEST_PER_MINUTE", 60),
      shortWindowSeconds: MINUTE,
    },
    "gap-view": {
      shortCapacity: positive("RATE_LIMIT_GAP_VIEW_PER_HOUR", 60),
      shortWindowSeconds: HOUR,
    },
  };
}

function positive(name: string, fallback: number): number {
  const raw = process.env[name];
  const value = raw === undefined || raw === "" ? fallback : Number(raw);
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`${name} debe ser un número >= 1 (recibido: ${raw})`);
  }
  return value;
}
