import pg from "pg";
import { getDatabaseUrl } from "../config";

/**
 * Pool de Postgres. Se crea bajo demanda (no al importar) para que los comandos
 * que no tocan la base de datos no exijan DATABASE_URL.
 *
 * Admite una cadena explícita para el único caso que no puede salir del .env:
 * el test de integración del schema, que apunta a su propia base desechable y
 * nunca a la del desarrollo (ver `TEST_DATABASE_URL` en .env.example).
 */
export function createPool(connectionString: string = getDatabaseUrl()): pg.Pool {
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);

  return new pg.Pool({
    connectionString,
    // Supabase y la mayoría de proveedores gestionados exigen SSL; en local no.
    ssl: isLocal ? false : { rejectUnauthorized: false },
  });
}
