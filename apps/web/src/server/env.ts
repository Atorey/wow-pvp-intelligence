import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

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
