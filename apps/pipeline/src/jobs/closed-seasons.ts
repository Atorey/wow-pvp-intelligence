import type pg from "pg";
import { uploadObject, type StorageConfig } from "@wowpvp/storage";
import { forgetGarbage, noteGarbage } from "../archive-journal";
import { encodeRows } from "../storage";

/**
 * Una temporada cerrada sale de Postgres entera (ADR 0042).
 *
 * El archivado del ADR 0034 conserva de cada serie el ancla, el último gear, los
 * últimos talentos y el pico, porque la ingesta, la actividad y la ficha los
 * leen. En una temporada cerrada ya no los lee ninguna de las tres: no entra
 * leaderboard nuevo, la actividad solo se recalcula para la vigente y la ficha
 * de quien solo jugó esa temporada la resume desde el índice de rating de
 * Storage. Lo que quedaba —medido el 26 de septiembre de 2026, 134.335 series de
 * la temporada 41 en tres tablas— era peso muerto.
 *
 * Los snapshots los mueve el bucle de siempre de `archive-snapshots`, que para
 * una temporada cerrada no conserva nada: así pasan por el índice de rating
 * antes de borrarse, como cualquier otra fila. Aquí está lo que ese bucle no
 * toca, las tablas derivadas de la temporada, y la decisión de cuáles están
 * cerradas.
 */

/**
 * Días sin una sola observación nueva para dar una temporada por cerrada. En el
 * cambio de temporada conviven filas de las dos durante días; dos semanas de
 * silencio son la prueba de que ya no llega nada.
 */
export const CLOSED_SEASON_GRACE_DAYS = 14;

/** Filas por objeto subido: holgado bajo el tope de 50 MB por objeto de Storage. */
const ROWS_PER_OBJECT = 50_000;

const MS_PER_DAY = 86_400_000;

export interface SeasonSeen {
  seasonId: number;
  /** La observación más reciente en `character_snapshots`; null si ya no queda ninguna. */
  lastCapturedAt: Date | null;
}

/**
 * Las temporadas que se pueden sacar enteras, de la más antigua a la más nueva.
 *
 * La vigente es la más alta que todavía tiene observaciones, y nunca se cierra.
 * Una anterior se cierra cuando lleva `graceDays` sin observaciones nuevas, o
 * cuando ya no le queda ninguna —una corrida anterior movió sus snapshots y se
 * cortó antes de sus tablas derivadas—.
 */
export function pickClosedSeasons(
  seasons: readonly SeasonSeen[],
  now: Date,
  graceDays: number = CLOSED_SEASON_GRACE_DAYS,
): number[] {
  const observed = seasons.filter((s) => s.lastCapturedAt !== null).map((s) => s.seasonId);
  if (observed.length === 0) return [];
  const current = Math.max(...observed);
  const quietSince = now.getTime() - graceDays * MS_PER_DAY;

  return [...new Set(seasons.map((s) => s.seasonId))]
    .filter((seasonId) => seasonId < current)
    .filter((seasonId) =>
      seasons.every(
        (s) =>
          s.seasonId !== seasonId ||
          s.lastCapturedAt === null ||
          s.lastCapturedAt.getTime() < quietSince,
      ),
    )
    .sort((a, b) => a - b);
}

/** Qué temporadas aparecen en cada tabla que guarda una, con su última observación. */
export async function findClosedSeasons(client: pg.PoolClient, now: Date): Promise<number[]> {
  const { rows } = await client.query<{ season_id: number; last: Date | null }>(
    `select season_id, max(captured_at) as last from character_snapshots group by season_id
     union all select distinct season_id, null::timestamptz from character_activity
     union all select distinct season_id, null::timestamptz from character_presence
     union all select distinct season_id, null::timestamptz from population_segments
     union all select distinct season_id, null::timestamptz from segment_coverage`,
  );
  return pickClosedSeasons(
    rows.map((row) => ({ seasonId: row.season_id, lastCapturedAt: row.last })),
    now,
  );
}

/**
 * La lista de temporadas escrita como literal SQL, para `create table as`, que
 * no acepta parámetros. Solo enteros: cualquier otra cosa es un error del job.
 */
export function seasonListSql(seasons: readonly number[]): string {
  for (const season of seasons) {
    if (!Number.isInteger(season)) throw new Error(`Temporada no entera: ${season}`);
  }
  return seasons.join(", ");
}

/** La carpeta de una corrida dentro del bucket. Sin `:`, que Storage no admite en una clave. */
export function archiveRunStamp(runStartedAt: Date): string {
  return runStartedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
}

/**
 * Las tablas derivadas de una temporada, en el orden en que se borran. Cada una
 * con la consulta que la lee entera: `aggregate_snapshots` no tiene temporada
 * propia y la hereda de su segmento.
 */
const SEASON_TABLES = [
  {
    table: "aggregate_snapshots",
    select: `select a.* from aggregate_snapshots a
               join population_segments p on p.id = a.population_segment_id
              where p.season_id = $1`,
    remove: `delete from aggregate_snapshots a using population_segments p
              where p.id = a.population_segment_id and p.season_id = $1`,
  },
  {
    table: "population_segments",
    select: "select * from population_segments where season_id = $1",
    remove: "delete from population_segments where season_id = $1",
  },
  {
    table: "segment_coverage",
    select: "select * from segment_coverage where season_id = $1",
    remove: "delete from segment_coverage where season_id = $1",
  },
  {
    table: "character_activity",
    select: "select * from character_activity where season_id = $1",
    remove: "delete from character_activity where season_id = $1",
  },
  {
    table: "character_presence",
    select: "select * from character_presence where season_id = $1",
    remove: "delete from character_presence where season_id = $1",
  },
] as const;

export type SeasonTable = (typeof SEASON_TABLES)[number]["table"];

export interface SeasonTablesReport {
  seasonId: number;
  rows: Record<SeasonTable, number>;
  bytes: number;
}

/** Lo que se movería de una temporada cerrada, sin mover nada. */
export async function countSeasonTables(
  client: pg.PoolClient,
  seasonId: number,
): Promise<SeasonTablesReport> {
  const rows = {} as Record<SeasonTable, number>;
  for (const { table, select } of SEASON_TABLES) {
    const { rows: counted } = await client.query<{ n: string }>(
      `select count(*) as n from (${select}) x`,
      [seasonId],
    );
    rows[table] = Number(counted[0]?.n ?? 0);
  }
  return { seasonId, rows, bytes: 0 };
}

/**
 * Sube las tablas derivadas de una temporada cerrada y las borra.
 *
 * Mismo orden que el archivado de snapshots: primero se sube todo, después se
 * borra en una sola transacción, y el borrado tiene que alcanzar exactamente lo
 * que se subió o se deshace. Se niega a empezar mientras quede un solo snapshot
 * de la temporada: la actividad heredada se archiva **después** de que el bucle
 * de snapshots le haya sumado sus últimas observaciones archivadas.
 */
export async function archiveSeasonTables(
  client: pg.PoolClient,
  storage: StorageConfig,
  runStartedAt: Date,
  seasonId: number,
): Promise<SeasonTablesReport> {
  const { rows: left } = await client.query<{ n: string }>(
    "select count(*) as n from character_snapshots where season_id = $1",
    [seasonId],
  );
  if (Number(left[0]?.n ?? 0) > 0) {
    throw new Error(
      `La temporada ${seasonId} todavía tiene ${left[0]?.n} snapshots en Postgres: ` +
        `sus tablas derivadas no se archivan hasta que salgan todos.`,
    );
  }

  const prefix = `seasons/s${seasonId}/${archiveRunStamp(runStartedAt)}`;
  const report: SeasonTablesReport = {
    seasonId,
    rows: {} as Record<SeasonTable, number>,
    bytes: 0,
  };

  // Cada fichero se anota antes de subirlo y se desanota al confirmar el
  // borrado: si algo falla entre medias, la siguiente corrida borra lo subido
  // en vez de dejar una copia que nadie sabe que está (ADR 0043).
  const uploaded: string[] = [];
  for (const { table, select } of SEASON_TABLES) {
    const { rows } = await client.query<object>(select, [seasonId]);
    report.rows[table] = rows.length;
    for (let start = 0; start < rows.length; start += ROWS_PER_OBJECT) {
      const part = String(start / ROWS_PER_OBJECT + 1).padStart(4, "0");
      const path = `${prefix}/${table}-${part}.ndjson.gz`;
      const body = encodeRows(rows.slice(start, start + ROWS_PER_OBJECT));
      await noteGarbage(client, [path]);
      await uploadObject(storage, path, body);
      uploaded.push(path);
      report.bytes += body.length;
    }
  }

  await client.query("begin");
  try {
    await forgetGarbage(client, uploaded);
    for (const { table, remove } of SEASON_TABLES) {
      const deleted = await client.query(remove, [seasonId]);
      if (deleted.rowCount !== report.rows[table]) {
        throw new Error(
          `${table} de la temporada ${seasonId}: se subieron ${report.rows[table]} filas y el ` +
            `borrado alcanzó ${deleted.rowCount}. Se deshace para no borrar nada que no esté en el archivo.`,
        );
      }
    }
    // Una corrida posterior puede encontrar restos de la misma temporada —una
    // fila rezagada— y se suman a lo que ya constaba en vez de pisarlo.
    await client.query(
      `insert into archived_seasons
         (season_id, object_prefix, activity_rows, presence_rows, segment_rows,
          aggregate_rows, coverage_rows)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (season_id) do update set
         archived_at    = now(),
         object_prefix  = excluded.object_prefix,
         activity_rows  = archived_seasons.activity_rows + excluded.activity_rows,
         presence_rows  = archived_seasons.presence_rows + excluded.presence_rows,
         segment_rows   = archived_seasons.segment_rows + excluded.segment_rows,
         aggregate_rows = archived_seasons.aggregate_rows + excluded.aggregate_rows,
         coverage_rows  = archived_seasons.coverage_rows + excluded.coverage_rows`,
      [
        seasonId,
        prefix,
        report.rows.character_activity,
        report.rows.character_presence,
        report.rows.population_segments,
        report.rows.aggregate_snapshots,
        report.rows.segment_coverage,
      ],
    );
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }

  return report;
}
