import pg from "pg";
import { getDatabaseUrl } from "../config";

/**
 * Pool de Postgres. Se crea bajo demanda (no al importar) para que los comandos
 * que no tocan la base de datos no exijan DATABASE_URL.
 */
export function createPool(): pg.Pool {
  const connectionString = getDatabaseUrl();
  const isLocal = /@(localhost|127\.0\.0\.1)/.test(connectionString);

  return new pg.Pool({
    connectionString,
    // Supabase y la mayoría de proveedores gestionados exigen SSL; en local no.
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}
