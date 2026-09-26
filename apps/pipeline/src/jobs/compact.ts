import type pg from "pg";
import { createPool } from "../db/pool";
import { formatMb } from "./db-size";

/**
 * Devuelve a la cuota el espacio que un borrado deja dentro de los ficheros.
 *
 * La cuota de Supabase mide ficheros, no filas vivas. Un `delete` —el archivado
 * de cada noche, una temporada cerrada que sale entera— deja hueco que
 * reutilizan las inserciones siguientes, pero el fichero no encoge: solo lo hace
 * un `VACUUM FULL`, que reescribe la tabla (ADR 0034, consecuencias). Hasta este
 * comando se lanzaba a mano desde el SQL editor.
 *
 * No corre en ningún workflow, y es a propósito. `VACUUM FULL` bloquea la tabla
 * entera mientras la copia, así que la ingesta que llegue en ese rato espera, y
 * necesita sitio para la copia nueva antes de soltar la vieja. Se lanza a mano
 * después de un archivado grande, fuera de la hora de los workflows.
 */

/** Por debajo de esto una tabla no devuelve nada que se note en la cuota. */
const DEFAULT_MIN_MB = 5;

export interface Options {
  /** Tablas explícitas; vacío es "todas las de public por encima de minMb". */
  tables: string[];
  minMb: number;
  dryRun: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { tables: [], minMb: DEFAULT_MIN_MB, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--tables") {
      const raw = args[++i] ?? "";
      options.tables = raw.split(",").filter((table) => table !== "");
      // El nombre acaba dentro de un VACUUM, que no acepta parámetros: solo se
      // admite lo que puede ser un identificador sin comillas.
      const bad = options.tables.find((table) => !/^[a-z_][a-z0-9_]*$/.test(table));
      if (options.tables.length === 0 || bad !== undefined) {
        throw new Error(`--tables="${raw}" debe ser una lista de tablas separadas por comas.`);
      }
      continue;
    }
    if (flag === "--min-mb") {
      const raw = args[++i];
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || value < 0) {
        throw new Error(`--min-mb="${raw ?? ""}" debe ser un número de MB no negativo.`);
      }
      options.minMb = value;
      continue;
    }
    throw new Error(`Opción desconocida: ${flag}. Disponibles: --tables, --min-mb, --dry-run.`);
  }

  return options;
}

export async function compact(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const pool = createPool();
  const client = await pool.connect();

  try {
    // Un VACUUM FULL de la tabla grande tarda más que el statement_timeout del pooler.
    await client.query("set statement_timeout = 0");
    const tables = await pickTables(client, options);
    const dbBefore = await databaseBytes(client);

    console.log(`Base: ${formatMb(dbBefore)}. Tablas a compactar: ${tables.length}.\n`);
    if (options.dryRun) {
      for (const table of tables)
        console.log(`  ${table.name.padEnd(34)} ${formatMb(table.bytes)}`);
      console.log("\n--dry-run: no se ha compactado nada.");
      return;
    }

    for (const table of tables) {
      const started = Date.now();
      await client.query(`vacuum (full, analyze) public.${table.name}`);
      const after = await tableBytes(client, table.name);
      console.log(
        `  ${table.name.padEnd(34)} ${formatMb(table.bytes).padStart(10)} → ` +
          `${formatMb(after).padStart(10)}  (${((Date.now() - started) / 1000).toFixed(0)} s)`,
      );
    }

    console.log(`\nBase: ${formatMb(dbBefore)} → ${formatMb(await databaseBytes(client))}`);
  } finally {
    client.release();
    await pool.end();
  }
}

/**
 * Las tablas pedidas, o las de `public` por encima del mínimo, de la más pequeña
 * a la más grande: cada una libera sitio antes de que la siguiente necesite el
 * suyo para su copia.
 */
async function pickTables(
  client: pg.PoolClient,
  options: Options,
): Promise<{ name: string; bytes: number }[]> {
  const { rows } = await client.query<{ name: string; bytes: string }>(
    `select c.relname as name, pg_total_relation_size(c.oid) as bytes
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r'
        and (cardinality($1::text[]) = 0 and pg_total_relation_size(c.oid) >= $2
             or c.relname = any($1::text[]))
      order by pg_total_relation_size(c.oid)`,
    [options.tables, Math.round(options.minMb * 1024 * 1024)],
  );

  const missing = options.tables.filter((table) => !rows.some((row) => row.name === table));
  if (missing.length > 0) throw new Error(`No existen en public: ${missing.join(", ")}.`);

  return rows.map((row) => ({ name: row.name, bytes: Number(row.bytes) }));
}

async function tableBytes(client: pg.PoolClient, table: string): Promise<number> {
  const { rows } = await client.query<{ bytes: string }>(
    "select pg_total_relation_size($1::regclass) as bytes",
    [`public.${table}`],
  );
  return Number(rows[0]?.bytes ?? 0);
}

async function databaseBytes(client: pg.PoolClient): Promise<number> {
  const { rows } = await client.query<{ bytes: string }>(
    "select pg_database_size(current_database()) as bytes",
  );
  return Number(rows[0]?.bytes ?? 0);
}
