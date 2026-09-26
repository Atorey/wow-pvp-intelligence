import {
  addToRatingHistoryShard,
  emptyRatingHistoryShard,
  groupByRatingHistoryObject,
  mergeRatingPoints,
  type RatingHistoryShard,
  type RatingObservation,
} from "@wowpvp/core";
import {
  downloadObject,
  ensureBucket,
  readRatingHistoryShard,
  writeRatingHistoryShard,
  type Fetch,
  type StorageConfig,
} from "@wowpvp/storage";
import { getArchiveStorage } from "../config";
import { createPool } from "../db/pool";
import { decodeRows } from "../storage";

/**
 * El índice por personaje del histórico de rating (ADR 0039).
 *
 * Lo mantiene el archivado: antes de borrar un lote de Postgres, sus puntos
 * entran aquí. Y lo archivado antes de que existiera el índice entra una sola
 * vez con `backfill-rating-history`, que recorre los lotes del archivo.
 */

/** Una fila de `character_snapshots` con lo único que el índice guarda de ella. */
export interface RatingRow {
  character_id: string;
  bracket: string;
  season_id: number;
  /** `Date` desde `pg`; texto ISO desde un lote del archivo. */
  captured_at: Date | string;
  rating: number;
}

export function toObservation(row: RatingRow): RatingObservation {
  return {
    characterId: row.character_id,
    bracket: row.bracket,
    seasonId: row.season_id,
    at: new Date(row.captured_at),
    rating: row.rating,
  };
}

export interface IndexReport {
  /** Objetos del índice reescritos. */
  objects: number;
  /** Series tocadas, sumadas por objeto. */
  series: number;
  bytes: number;
}

/**
 * Funde unas observaciones con el índice: baja cada shard afectado, le suma lo
 * nuevo y lo vuelve a subir entero.
 *
 * Reescribir el objeto no pierde nada porque la fusión es una unión
 * (`mergeRatingPoints`), y por lo mismo repetirla con las mismas observaciones
 * no cambia el resultado. Lo que **no** soporta es a dos procesos escribiendo el
 * mismo shard a la vez: el último en subir borraría lo que añadió el otro. El
 * archivado corre en un workflow con `concurrency`, y el backfill se lanza a
 * mano; si coincidieran, volver a lanzar el backfill lo repara, porque relee
 * todos los lotes.
 */
export async function indexRatingHistory(
  storage: StorageConfig,
  observations: readonly RatingObservation[],
  fetchFn: Fetch = fetch,
): Promise<IndexReport> {
  const report: IndexReport = { objects: 0, series: 0, bytes: 0 };

  for (const group of groupByRatingHistoryObject(observations).values()) {
    const shard =
      (await readRatingHistoryShard(storage, group.seasonId, group.shard, fetchFn)) ??
      emptyRatingHistoryShard(group.seasonId, group.shard);
    report.series += addToRatingHistoryShard(shard, group.observations);
    report.bytes += await writeRatingHistoryShard(storage, shard, fetchFn);
    report.objects++;
  }

  return report;
}

/**
 * Funde un shard armado en memoria con el que ya hay en Storage y lo sube.
 *
 * Es la versión por lotes de `indexRatingHistory`: el backfill junta cientos de
 * miles de observaciones y las reparte por shard antes de tocar la red, para
 * bajar y subir cada objeto una vez y no una por lote del archivo.
 */
async function flushShard(
  storage: StorageConfig,
  built: RatingHistoryShard,
  fetchFn: Fetch,
): Promise<number> {
  const stored = await readRatingHistoryShard(storage, built.seasonId, built.shard, fetchFn);
  for (const [key, points] of stored?.series ?? []) {
    built.series.set(key, mergeRatingPoints(points, built.series.get(key) ?? []));
  }
  return writeRatingHistoryShard(storage, built, fetchFn);
}

export interface BackfillOptions {
  /** Lee el archivo y cuenta, sin escribir el índice. */
  dryRun: boolean;
}

export function parseBackfillOptions(args: string[]): BackfillOptions {
  const options: BackfillOptions = { dryRun: false };
  for (const flag of args) {
    if (flag === "--dry-run") options.dryRun = true;
    else throw new Error(`Opción desconocida: ${flag}. Disponible: --dry-run.`);
  }
  return options;
}

interface BatchRow {
  object_prefix: string;
  snapshots: number;
}

export async function backfillRatingHistory(args: string[] = []): Promise<void> {
  const options = parseBackfillOptions(args);
  const storage = getArchiveStorage();
  const pool = createPool();

  try {
    // La bitácora es el índice del archivo (ADR 0034): se recorre ella y no el
    // bucket, que mezcla los lotes con el propio índice.
    const { rows: batches } = await pool.query<BatchRow>(
      `select object_prefix, snapshots from snapshot_archive_batches order by object_prefix`,
    );
    const report = await backfill(storage, batches, options);
    console.log(
      `\n${fmt(report.observations)} observaciones de ${fmt(batches.length)} lotes, en ` +
        `${fmt(report.objects)} objetos del índice.`,
    );
    if (options.dryRun) console.log("--dry-run: no se ha escrito nada.");
    else console.log(`Subido: ${(report.bytes / 1_048_576).toFixed(1)} MB.`);
  } finally {
    await pool.end();
  }
}

export async function backfill(
  storage: StorageConfig,
  batches: readonly BatchRow[],
  options: BackfillOptions,
  fetchFn: Fetch = fetch,
): Promise<{ observations: number; objects: number; bytes: number }> {
  const shards = new Map<string, RatingHistoryShard>();
  let observations = 0;

  for (const batch of batches) {
    const path = `${batch.object_prefix}/character_snapshots.ndjson.gz`;
    const body = await downloadObject(storage, path, fetchFn);
    // La bitácora dice que el lote existe: si no está, falta histórico y nadie
    // lo sabría si se saltara en silencio.
    if (!body)
      throw new Error(`El lote ${batch.object_prefix} está en la bitácora y no en Storage.`);

    const rows = decodeRows<RatingRow>(body);
    if (rows.length !== batch.snapshots) {
      throw new Error(
        `El lote ${batch.object_prefix} tiene ${rows.length} snapshots y la bitácora dice ` +
          `${batch.snapshots}.`,
      );
    }

    for (const [path, group] of groupByRatingHistoryObject(rows.map(toObservation))) {
      const shard = shards.get(path) ?? emptyRatingHistoryShard(group.seasonId, group.shard);
      addToRatingHistoryShard(shard, group.observations);
      shards.set(path, shard);
    }
    observations += rows.length;
    console.log(`  ${batch.object_prefix}: ${fmt(rows.length)} snapshots`);
  }

  let bytes = 0;
  if (!options.dryRun) {
    await ensureBucket(storage, fetchFn);
    for (const shard of shards.values()) bytes += await flushShard(storage, shard, fetchFn);
  }

  return { observations, objects: shards.size, bytes };
}

const fmt = (value: number): string => value.toLocaleString("es-ES");
