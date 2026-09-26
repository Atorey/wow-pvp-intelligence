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
export async function migrate(args: string[] = []): Promise<void> {
  const rehearse = parseRehearse(args);
  const pool = createPool();
  try {
    if (rehearse) await rehearseMigrations(pool);
    else await applyMigrations(pool);
  } finally {
    await pool.end();
  }
}

export function parseRehearse(args: readonly string[]): boolean {
  for (const flag of args) {
    if (flag !== "--rehearse") {
      throw new Error(`Opción desconocida: ${flag}. Disponible: --rehearse.`);
    }
  }
  return args.length > 0;
}

/**
 * Ensayo revertido: aplica lo pendiente en **una** transacción, mide y deshace.
 *
 * Existe porque cada workflow ejecuta `db:migrate` antes de su trabajo, así que
 * una migración que llega a `main` se aplica sola en producción con la próxima
 * corrida. Las que reescriben tablas enteras (0021, 0022, 0023) no se pueden
 * probar contra una copia —no la hay, y el dataset de desarrollo no tiene la
 * forma de los datos reales—, así que se ensayan contra producción sin dejar
 * nada: es lo que se hizo a mano con la 0021 (ADR 0035), convertido en comando.
 *
 * Lo que se mide son las relaciones visibles dentro de la transacción: una tabla
 * que la migración borra deja de contar aunque su fichero siga ahí hasta el
 * commit. Es el tamaño que tendrá la base al aplicarla, no el pico de mientras
 * se aplica, y el pico se dice aparte porque es el que puede no caber.
 *
 * Mientras dura, la transacción tiene los bloqueos de la migración: una tabla
 * que se reescribe no admite escrituras hasta el rollback.
 */
async function rehearseMigrations(pool: pg.Pool): Promise<void> {
  const client = await pool.connect();
  try {
    // Se avisa antes de cada espera y no solo al acabar: una migración que
    // reescribe una tabla tarda minutos, y en ese rato una terminal en blanco no
    // distingue "trabajando" de "esperando un bloqueo".
    console.log("Esperando el candado de migraciones…");
    await client.query("select pg_advisory_lock(hashtext('wowpvp:migrations'))");
    const pending = await pendingMigrations(client);
    if (pending.length === 0) {
      console.log("Nada que ensayar: no hay migraciones pendientes.");
      return;
    }
    console.log(`Ensayo de ${pending.length} migración(es): ${pending.join(", ")}\n`);

    await client.query("begin");
    try {
      const before = await relationSizes(client);
      for (const file of pending) {
        console.log(`… ${file}`);
        const started = Date.now();
        await client.query(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8"));
        console.log(`✅ ${file} · ${((Date.now() - started) / 1000).toFixed(1)} s`);
      }
      const after = await relationSizes(client);
      printSizeDiff(before, after);
    } finally {
      await client.query("rollback");
      console.log("\nEnsayo deshecho: la base está como antes de empezar.");
    }
  } finally {
    await client.query("select pg_advisory_unlock(hashtext('wowpvp:migrations'))");
    client.release();
  }
}

async function pendingMigrations(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ exists: boolean }>(
    "select to_regclass('public.schema_migrations') is not null as exists",
  );
  const applied = rows[0]?.exists
    ? new Set(
        (
          await client.query<{ filename: string }>("select filename from schema_migrations")
        ).rows.map((r) => r.filename),
      )
    : new Set<string>();
  return fs
    .readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql") && !applied.has(f))
    .sort();
}

export interface RelationSize {
  /** El oid y no el nombre identifica la tabla: 0021-0023 renombran una y crean otra con su nombre. */
  oid: number;
  name: string;
  bytes: number;
}

async function relationSizes(client: pg.PoolClient): Promise<RelationSize[]> {
  const { rows } = await client.query<{ oid: number; name: string; bytes: string }>(
    `select c.oid::int as oid, c.relname as name, pg_total_relation_size(c.oid) as bytes
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r', 'p', 'm')`,
  );
  return rows.map((row) => ({ oid: row.oid, name: row.name, bytes: Number(row.bytes) }));
}

export interface SizeDiff {
  /** Por nombre, que es como se lee: una tabla recreada con el mismo nombre sale una vez. */
  changed: { name: string; before: number | null; after: number | null }[];
  before: number;
  after: number;
  /** Lo que ocupa a la vez mientras la migración no ha hecho commit: lo viejo más lo creado. */
  peak: number;
}

export function sizeDiff(
  before: readonly RelationSize[],
  after: readonly RelationSize[],
): SizeDiff {
  const byName = (sizes: readonly RelationSize[]): Map<string, number> =>
    new Map(sizes.map((r) => [r.name, r.bytes]));
  const was = byName(before);
  const now = byName(after);
  const sum = (sizes: readonly RelationSize[]): number => sizes.reduce((s, r) => s + r.bytes, 0);

  const changed = [...new Set([...was.keys(), ...now.keys()])]
    .map((name) => ({ name, before: was.get(name) ?? null, after: now.get(name) ?? null }))
    .filter((row) => row.before !== row.after)
    .sort((a, b) => (a.after ?? 0) - (a.before ?? 0) - ((b.after ?? 0) - (b.before ?? 0)));

  const existed = new Set(before.map((r) => r.oid));
  const created = sum(after.filter((r) => !existed.has(r.oid)));

  return { changed, before: sum(before), after: sum(after), peak: sum(before) + created };
}

function printSizeDiff(before: readonly RelationSize[], after: readonly RelationSize[]): void {
  const mb = (bytes: number | null): string =>
    bytes === null ? "—" : `${(bytes / 1_048_576).toFixed(1)} MB`;
  const diff = sizeDiff(before, after);

  console.log("\nTablas que cambian:");
  for (const row of diff.changed) {
    console.log(
      `  ${row.name.padEnd(34)} ${mb(row.before).padStart(10)} → ${mb(row.after).padStart(10)}`,
    );
  }
  console.log(`\npublic: ${mb(diff.before)} → ${mb(diff.after)}`);
  // El pico es lo que tiene que caber mientras la migración corre: lo nuevo
  // convive con lo viejo hasta el commit.
  console.log(`Pico durante la migración: unos ${mb(diff.peak)}`);
}

/**
 * El runner en sí, sobre un pool que abre y cierra quien llama.
 *
 * Separado de `migrate()` porque el test de integración del schema (#64) migra
 * su propia base desechable: es lo que hace que una columna renombrada en una
 * migración rompa el test en vez de descubrirse en la primera consulta real.
 */
export async function applyMigrations(pool: pg.Pool): Promise<void> {
  // Un solo migrador a la vez sobre la misma base. `create table if not exists`
  // parece idempotente y no lo es bajo concurrencia: dos sesiones creando la
  // misma tabla a la vez chocan en el catálogo de Postgres. Pasa en cuanto dos
  // tests de integración arrancan en paralelo, y pasaría igual con dos runners.
  const lock = await pool.connect();
  try {
    await lock.query("select pg_advisory_lock(hashtext('wowpvp:migrations'))");
    await runPending(pool);
  } finally {
    await lock.query("select pg_advisory_unlock(hashtext('wowpvp:migrations'))");
    lock.release();
  }
}

async function runPending(pool: pg.Pool): Promise<void> {
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
