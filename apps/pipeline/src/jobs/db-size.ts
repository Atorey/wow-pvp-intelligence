import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { REPO_ROOT } from "../config";
import { createPool } from "../db/pool";
import { DEFAULT_HOT_DAYS as HOT_WINDOW_DAYS } from "./archive-snapshots";

/**
 * Qué ocupa la base y por qué.
 *
 * La cuota de 500 MB del plan gratuito de Supabase se descubrió cuando ya estaba
 * rebasada, y cada recorte desde entonces se decidió con una medición hecha a
 * mano que no se podía repetir. Este comando es esa medición, en dos pesos:
 *
 * - **Sin opciones** es barata: tamaño de la base, reparto por esquema, por tabla
 *   y por índice, y migraciones aplicadas. Corre a diario desde el workflow
 *   `Freshness` y **falla por encima de `--alert-mb`**: el fallo del workflow es
 *   el aviso, igual que en `check-freshness`.
 * - **`--detail`** contesta a lo que decide un recorte: cuánto de cada tabla es
 *   ventana caliente y cuánto se conserva fuera de ella, por temporada, y cuánto
 *   contenido distinto sostiene cada catálogo del ADR 0040. Recorre las tablas
 *   de observación enteras, así que es para lanzarlo a mano, no a diario.
 *
 * Todo corre en una transacción `read only`: medir no puede escribir, y si una
 * consulta de este fichero lo intentara, Postgres la rechazaría.
 */

/** Cuota de base de datos del plan gratuito de Supabase. */
const QUOTA_MB = 500;

/**
 * Umbral del aviso por defecto. No es la cuota: avisar al llegar a 500 es avisar
 * cuando ya no hay nada que hacer. Con 100 MB de margen hay días para reaccionar
 * incluso al ritmo de crecimiento de antes del archivado.
 */
const DEFAULT_ALERT_MB = 400;

/**
 * MB de 1024 × 1024, los de `pg_size_pretty`. Todas las cifras del proyecto
 * sobre la cuota (1.176, 961, 689, 665) se midieron así, y cambiar de unidad a
 * mitad de la serie fabricaría un ahorro que no existe.
 */
const MB = 1024 * 1024;

/** Las tablas que `--detail` desglosa. Por debajo de esto no hay recorte que valga una consulta cara. */
const DETAIL_MIN_TABLE_BYTES = 5 * MB;

export interface Options {
  detail: boolean;
  alertMb: number;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { detail: false, alertMb: DEFAULT_ALERT_MB };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--detail") {
      options.detail = true;
      continue;
    }
    if (flag === "--alert-mb") {
      const raw = args[++i];
      const value = Number(raw);
      if (!raw || !Number.isInteger(value) || value < 1) {
        throw new Error(`--alert-mb="${raw ?? ""}" debe ser un entero mayor que cero.`);
      }
      options.alertMb = value;
      continue;
    }
    throw new Error(`Opción desconocida: ${flag}. Disponibles: --detail, --alert-mb.`);
  }

  return options;
}

export type QuotaStatus = "ok" | "alert" | "over-quota";

/**
 * Dónde está la base respecto al aviso y a la cuota. Por encima de la cuota es
 * un estado distinto de por encima del aviso, y se dice distinto: uno pide
 * planificar un recorte y el otro tiene fecha de restricción.
 */
export function quotaStatus(bytes: number, alertMb: number): QuotaStatus {
  if (bytes > QUOTA_MB * MB) return "over-quota";
  if (bytes > alertMb * MB) return "alert";
  return "ok";
}

export function formatMb(bytes: number | string): string {
  return `${(Number(bytes) / MB).toFixed(1)} MB`;
}

function pct(part: number | string, whole: number | string): string {
  const w = Number(whole);
  return w === 0 ? "—" : `${((Number(part) / w) * 100).toFixed(1)}%`;
}

export async function dbSize(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const pool = createPool();
  const client = await pool.connect();

  let status: QuotaStatus = "ok";
  try {
    await client.query("begin transaction read only");
    status = await printOverview(client, options);
    if (options.detail) await printDetail(client);
    await client.query("rollback");
  } finally {
    client.release();
    await pool.end();
  }

  if (status !== "ok") process.exit(1);
}

async function printOverview(client: pg.PoolClient, options: Options): Promise<QuotaStatus> {
  const { rows: dbRows } = await client.query<{ bytes: string; stats_reset: Date | null }>(
    `select pg_database_size(current_database()) as bytes,
            (select stats_reset from pg_stat_database where datname = current_database()) as stats_reset`,
  );
  const dbBytes = Number(dbRows[0]?.bytes ?? 0);
  const status = quotaStatus(dbBytes, options.alertMb);

  console.log(`Tamaño de la base · ${new Date().toISOString()}\n`);
  console.log(
    `${status === "ok" ? "✅" : status === "alert" ? "⚠️ " : "❌"} ${formatMb(dbBytes)} ` +
      `de ${QUOTA_MB} MB de cuota (${pct(dbBytes, QUOTA_MB * MB)}) · aviso en ${options.alertMb} MB`,
  );

  // Por esquema, porque la cuota es la base entera y no solo `public`: Supabase
  // mete ahí `auth`, `storage` y sus propias bitácoras, y si una de ellas crece
  // no hay tabla nuestra que la explique.
  const { rows: schemas } = await client.query<{ schema: string; bytes: string }>(
    `select n.nspname as schema, sum(pg_total_relation_size(c.oid)) as bytes
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where c.relkind in ('r', 'm', 'p') and not c.relisshared
      group by n.nspname
      order by bytes desc`,
  );
  const inRelations = schemas.reduce((sum, row) => sum + Number(row.bytes), 0);
  console.log("\n=== POR ESQUEMA ===");
  for (const row of schemas.filter((r) => Number(r.bytes) >= MB)) {
    console.log(`  ${row.schema.padEnd(22)} ${formatMb(row.bytes).padStart(10)}`);
  }
  console.log(
    `  ${"(fuera de relaciones)".padEnd(22)} ${formatMb(dbBytes - inRelations).padStart(10)}`,
  );

  // Heap, TOAST e índices por separado porque cada uno se abarata de una forma:
  // el índice se quita, el TOAST se normaliza y el heap se archiva o se compacta.
  // Y las tuplas muertas porque la cuota mide ficheros: un delete sin VACUUM FULL
  // no devuelve nada (ADR 0034, consecuencias).
  const { rows: tables } = await client.query<{
    name: string;
    total: string;
    heap: string;
    toast: string;
    indexes: string;
    live: string | null;
    dead: string | null;
    last_vacuum: Date | null;
  }>(
    `select c.relname as name,
            pg_total_relation_size(c.oid) as total,
            pg_relation_size(c.oid) as heap,
            coalesce(pg_total_relation_size(nullif(c.reltoastrelid, 0)), 0) as toast,
            pg_indexes_size(c.oid) as indexes,
            s.n_live_tup as live,
            s.n_dead_tup as dead,
            greatest(s.last_vacuum, s.last_autovacuum) as last_vacuum
       from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
       left join pg_stat_user_tables s on s.relid = c.oid
      where n.nspname = 'public' and c.relkind in ('r', 'p')
      order by pg_total_relation_size(c.oid) desc`,
  );
  console.log("\n=== TABLAS DE public ===");
  console.log(
    `  ${"tabla".padEnd(34)} ${"total".padStart(10)} ${"heap".padStart(10)} ${"toast".padStart(9)} ` +
      `${"índices".padStart(10)} ${"vivas".padStart(10)} ${"muertas".padStart(9)}  último vacuum`,
  );
  for (const t of tables) {
    console.log(
      `  ${t.name.padEnd(34)} ${formatMb(t.total).padStart(10)} ${formatMb(t.heap).padStart(10)} ` +
        `${formatMb(t.toast).padStart(9)} ${formatMb(t.indexes).padStart(10)} ` +
        `${String(t.live ?? "?").padStart(10)} ${String(t.dead ?? "?").padStart(9)}  ` +
        `${t.last_vacuum?.toISOString().slice(0, 16) ?? "nunca"}`,
    );
  }

  // Un índice que ocupa y no se consulta es el recorte más barato que existe: no
  // cambia ni un dato. El contador es desde el último reset de estadísticas, que
  // se imprime para saber cuánto tiempo cubre ese cero.
  const { rows: indexes } = await client.query<{
    name: string;
    relation: string;
    bytes: string;
    scans: string;
    is_constraint: boolean;
  }>(
    `select i.indexrelname as name, i.relname as relation,
            pg_relation_size(i.indexrelid) as bytes, i.idx_scan as scans,
            (x.indisunique or x.indisprimary) as is_constraint
       from pg_stat_user_indexes i
       join pg_index x on x.indexrelid = i.indexrelid
      where i.schemaname = 'public' and pg_relation_size(i.indexrelid) >= $1
      order by pg_relation_size(i.indexrelid) desc`,
    [MB],
  );
  console.log(
    `\n=== ÍNDICES DE MÁS DE 1 MB (lecturas desde ${dbRows[0]?.stats_reset?.toISOString().slice(0, 10) ?? "siempre"}) ===`,
  );
  for (const idx of indexes) {
    console.log(
      `  ${idx.name.padEnd(58)} ${formatMb(idx.bytes).padStart(10)} ` +
        `${String(idx.scans).padStart(12)} lecturas${idx.is_constraint ? "  (unique/pk)" : ""}`,
    );
  }

  await printMigrations(client);
  return status;
}

/**
 * Qué migraciones constan como aplicadas frente a las del repo. La primera
 * hipótesis de la issue sobre la cuota era una migración sin aplicar, y es la
 * única que se contesta sin medir nada.
 */
async function printMigrations(client: pg.PoolClient): Promise<void> {
  const inRepo = fs
    .readdirSync(path.join(REPO_ROOT, "db", "migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  const { rows } = await client.query<{ filename: string; applied_at: Date }>(
    "select filename, applied_at from schema_migrations order by filename",
  );
  const applied = new Map(rows.map((row) => [row.filename, row.applied_at]));
  const pending = inRepo.filter((file) => !applied.has(file));
  const last = rows.at(-1);

  console.log("\n=== MIGRACIONES ===");
  console.log(
    `  ${applied.size} aplicadas; la última, ${last?.filename ?? "ninguna"} ` +
      `(${last?.applied_at.toISOString().slice(0, 16) ?? "—"})`,
  );
  console.log(
    pending.length === 0 ? "  Ninguna pendiente." : `  Pendientes: ${pending.join(", ")}`,
  );
}

/**
 * Lo que decide un recorte, tabla a tabla. Cada consulta contesta una pregunta
 * concreta y se imprime con ella delante, para que el número no se lea como
 * otra cosa.
 */
async function printDetail(client: pg.PoolClient): Promise<void> {
  // Estas consultas recorren las tablas de observación enteras. El tope evita
  // que una sola se quede bloqueando la conexión del pooler si algo va mal.
  await client.query("set local statement_timeout = '10min'");

  const { rows: big } = await client.query<{ name: string }>(
    `select c.relname as name
       from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and pg_total_relation_size(c.oid) >= $1`,
    [DETAIL_MIN_TABLE_BYTES],
  );
  const bigTables = new Set(big.map((row) => row.name));

  console.log("\n\n######## DETALLE ########");

  // 1) Qué parte de character_snapshots es ventana y qué parte se conserva fuera
  //    de ella (ancla, último gear, últimos talentos, pico: ADR 0034). Por
  //    temporada, porque lo que se conserva de una temporada cerrada ya no lo
  //    lee la ingesta por cambio ni el recálculo de actividad.
  const { rows: snapshots } = await client.query<{
    season_id: number;
    source: string;
    hot: string;
    kept: string;
    bytes: string;
  }>(
    `select season_id, source,
            count(*) filter (where captured_at >= now() - make_interval(days => $1)) as hot,
            count(*) filter (where captured_at <  now() - make_interval(days => $1)) as kept,
            sum(pg_column_size(s.*)) as bytes
       from character_snapshots s
      group by season_id, source
      order by season_id, source`,
    [HOT_WINDOW_DAYS],
  );
  console.log(
    `\n--- character_snapshots por temporada y origen (caliente = últimos ${HOT_WINDOW_DAYS} días) ---`,
  );
  for (const row of snapshots) {
    console.log(
      `  s${row.season_id} ${row.source.padEnd(12)} ${row.hot.padStart(9)} calientes ` +
        `${row.kept.padStart(9)} conservadas fuera  ${formatMb(row.bytes).padStart(10)} de tupla`,
    );
  }

  // 2) Series por temporada: es lo que fija el suelo de lo que se conserva, y lo
  //    que multiplica cualquier bracket nuevo.
  const { rows: series } = await client.query<{
    season_id: number;
    bracket_kind: string;
    n: string;
  }>(
    `select season_id,
            case when bracket like 'shuffle-%' then 'shuffle' else bracket end as bracket_kind,
            count(*) as n
       from character_activity
      group by 1, 2
      order by 1, 2`,
  );
  console.log("\n--- Series (personaje, bracket) en character_activity ---");
  for (const row of series) {
    console.log(`  s${row.season_id} ${row.bracket_kind.padEnd(12)} ${row.n.padStart(9)}`);
  }

  // 3) De los snapshots con gear, cuántos lee alguien. Los agregados y la ficha
  //    solo leen el último perfil de cada serie; el resto está ahí para el
  //    archivo.
  const { rows: gearUse } = await client.query<{ latest: string; older: string }>(
    `select count(*) filter (where rn = 1) as latest,
            count(*) filter (where rn > 1) as older
       from (select row_number() over (
                      partition by s.character_id, s.bracket, s.season_id
                      order by s.captured_at desc) as rn
               from character_snapshots s
              where exists (select 1 from character_snapshot_gear g where g.snapshot_id = s.id)) x`,
  );
  console.log("\n--- Snapshots con gear: el último de su serie frente a los anteriores ---");
  console.log(`  último de su serie: ${gearUse[0]?.latest}   anteriores: ${gearUse[0]?.older}`);

  // 4) Los catálogos de contenido (ADR 0040): cuántas piezas y conjuntos
  //    distintos sostienen cuántas referencias. Es la cifra que dice si el
  //    catálogo sigue compensando o si empieza a crecer tanto como lo que apunta,
  //    que es lo que pasaría si el contenido dejara de repetirse.
  const { rows: catalogs } = await client.query<{
    catalog: string;
    entries: string;
    observations: string;
    refs: string;
  }>(
    `select 'gear_pieces' as catalog,
            (select count(*) from gear_pieces) as entries,
            count(*) as observations,
            coalesce(sum(cardinality(piece_ids)), 0) as refs
       from character_snapshot_gear
     union all
     select 'talent_sets',
            (select count(*) from talent_sets),
            count(*),
            coalesce(sum(cardinality(set_ids)), 0)
       from character_snapshot_talents`,
  );
  console.log("\n--- Catálogos de contenido (ADR 0040) ---");
  for (const row of catalogs) {
    console.log(
      `  ${row.catalog.padEnd(12)} ${row.entries.padStart(9)} distintos para ` +
        `${row.refs.padStart(9)} referencias de ${row.observations} snapshots ` +
        `(${pct(row.entries, row.refs)})`,
    );
  }

  // 6) Tablas derivadas por temporada. Una temporada cerrada no vuelve a leerse
  //    desde ninguna pantalla de hoy, y es lo primero que saldría de la base.
  const { rows: derived } = await client.query<{
    relation: string;
    season_id: number;
    n: string;
  }>(
    `select 'population_segments' as relation, season_id, count(*) as n
       from population_segments group by season_id
     union all
     select 'aggregate_snapshots', p.season_id, count(*)
       from aggregate_snapshots a join population_segments p on p.id = a.population_segment_id
      group by p.season_id
     union all
     select 'character_presence', season_id, count(*) from character_presence group by season_id
     order by 1, 2`,
  );
  console.log("\n--- Tablas derivadas por temporada ---");
  for (const row of derived) {
    console.log(`  ${row.relation.padEnd(22)} s${row.season_id} ${row.n.padStart(10)} filas`);
  }

  // 7) Hinchazón medida, no estimada, si la extensión está. Crearla es una
  //    escritura y este comando no escribe: si falta, se dice cómo tenerla.
  const { rows: ext } = await client.query(
    "select 1 from pg_extension where extname = 'pgstattuple'",
  );
  console.log(
    "\n--- Espacio libre dentro de los ficheros (lo que solo devuelve un VACUUM FULL) ---",
  );
  if (ext.length === 0) {
    console.log(
      "  pgstattuple no está instalada. Para medirlo: `create extension pgstattuple;` " +
        "desde el SQL editor de Supabase, y volver a lanzar esto.",
    );
    return;
  }
  for (const name of [...bigTables].sort()) {
    const { rows } = await client.query<{
      table_len: string;
      dead_tuple_len: string;
      approx_free_space: string;
    }>(
      "select table_len, dead_tuple_len, approx_free_space from pgstattuple_approx($1::regclass)",
      [name],
    );
    const row = rows[0];
    if (!row) continue;
    const reclaimable = Number(row.dead_tuple_len) + Number(row.approx_free_space);
    console.log(
      `  ${name.padEnd(34)} heap ${formatMb(row.table_len).padStart(10)} · ` +
        `recuperable ${formatMb(reclaimable).padStart(10)} (${pct(reclaimable, row.table_len)})`,
    );
  }
}
