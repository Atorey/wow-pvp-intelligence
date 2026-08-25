import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { REPO_ROOT } from "../config";
import { createPool } from "./pool";

const MIGRATIONS_DIR = path.join(REPO_ROOT, "db", "migrations");

/**
 * Runner de migraciones mínimo: aplica en orden los .sql de db/migrations que
 * aún no consten en schema_migrations, cada uno en su propia transacción.
 *
 * Deliberadamente sin librería: son unas pocas migraciones sobre una única base
 * de datos. Reglas: los archivos ya aplicados no se editan nunca (se añade uno
 * nuevo), y cada uno debe poder aplicarse sobre una base ya poblada.
 */
export async function migrate(): Promise<void> {
  const pool = createPool();
  try {
    await applyMigrations(pool);
  } finally {
    await pool.end();
  }
}

/**
 * El runner en sí, sobre un pool que abre y cierra quien llama.
 *
 * Separado de `migrate()` porque el test de integración del schema (#64) migra
 * su propia base desechable: es lo que hace que una columna renombrada en una
 * migración rompa el test en vez de descubrirse en la primera consulta real.
 */
export async function applyMigrations(pool: pg.Pool): Promise<void> {
  await pool.query(`
    create table if not exists schema_migrations (
      filename    text primary key,
      applied_at  timestamptz not null default now()
    )
  `);

  const applied = new Set(
    (await pool.query<{ filename: string }>("select filename from schema_migrations")).rows.map(
      (r) => r.filename,
    ),
  );

  const files = fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const pending = files.filter((f) => !applied.has(f));

  if (pending.length === 0) {
    console.log(`Base de datos al día (${files.length} migraciones aplicadas).`);
    return;
  }

  for (const file of pending) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query(sql);
      await client.query("insert into schema_migrations (filename) values ($1)", [file]);
      await client.query("commit");
      console.log(`✅ ${file}`);
    } catch (err) {
      await client.query("rollback");
      throw new Error(`Falló la migración ${file}: ${err instanceof Error ? err.message : err}`);
    } finally {
      client.release();
    }
  }

  console.log(`\n${pending.length} migración(es) aplicada(s).`);
}
