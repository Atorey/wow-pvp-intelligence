import pg from "pg";
import { getDatabaseUrl } from "./env";

/**
 * La conexión a Postgres de la web.
 *
 * Es lo contrario de lo que hace el pipeline, y a propósito (ADR 0013, decisión
 * 10): allí un proceso largo abre un pool generoso y lo tiene ocupado durante
 * horas; aquí hay N instancias efímeras a la vez, y Postgres admite bastantes
 * menos conexiones que invocaciones concurrentes puede levantar Netlify. Por eso
 * la cadena apunta al **pooler de Supabase en modo transacción** y cada
 * instancia se queda con muy pocas.
 *
 * **Uno por proceso, no uno por invocación**, y eso no es solo ahorro de
 * conexiones: `BlizzardClient` mantiene una única cola por proceso y **se niega
 * a construirse con un segundo ejecutor** —dos ejecutores serían dos
 * contabilidades del mismo presupuesto de cuota—. Una instancia caliente que
 * sirve dos búsquedas es lo normal en serverless, así que un pool por invocación
 * rompería la segunda.
 *
 * No se cierra nunca, y tampoco hace falta: `idleTimeoutMillis` suelta la
 * conexión cuando la instancia se queda quieta, y cuando muere se cierra el
 * socket con ella.
 */
let pool: pg.Pool | null = null;

export function getDb(): pg.Pool {
  if (pool) return pool;

  const connectionString = getDatabaseUrl();
  const isLocal = /@(localhost|127\.0\.0\.1|\[::1\])/.test(connectionString);

  pool = new pg.Pool({
    connectionString,
    // Bastante para que dos peticiones de la misma instancia no se hagan cola
    // entre ellas, y poco para que N instancias calientes no vacíen el pooler.
    max: 3,
    // Una instancia que deja de recibir tráfico devuelve sus conexiones sola.
    idleTimeoutMillis: 10_000,
    // Supabase y la mayoría de proveedores gestionados exigen SSL; en local no.
    ssl: isLocal ? false : { rejectUnauthorized: false },
    // Un cuelgue al conectar no puede comerse el presupuesto de la función: son
    // 10 s en total y la búsqueda ya reserva 8 para hablar con Blizzard.
    connectionTimeoutMillis: 5_000,
  });

  return pool;
}
