import type pg from "pg";
import { ratingHistoryShard, removeCharactersFromShard, RATING_HISTORY_PREFIX } from "@wowpvp/core";
import {
  downloadObject,
  listObjects,
  readRatingHistoryShard,
  uploadObject,
  writeRatingHistoryShard,
  type Fetch,
  type StorageConfig,
} from "@wowpvp/storage";
import {
  collectGarbage,
  forgetGarbage,
  noteGarbage,
  releaseArchiveLock,
  takeArchiveLock,
} from "../archive-journal";
import { getArchiveStorage } from "../config";
import { MS_PER_DAY, PURGE_AT_DAYS } from "../data-ttl";
import { createPool } from "../db/pool";
import { decodeRows, encodeRows } from "../storage";
import { batchObjectPaths } from "./archive-snapshots";
import { archiveRunStamp } from "./closed-seasons";

/**
 * Saca del archivo de Storage a los personajes que ya no existen (ADR 0043).
 *
 * El borrado de Postgres lo hace quien descubre que el personaje no existe, en
 * la misma transacción, y deja su id en `character_erasures`. Lo archivado no
 * se puede borrar así: está repartido en lotes por fecha con la población
 * entera dentro (ADR 0034), en los ficheros de las temporadas cerradas (ADR
 * 0042) y en el índice de rating (ADR 0039). Esto recorre los tres y quita a
 * todos los pendientes de una vez.
 *
 * El archivo sigue sin sobrescribirse: un lote afectado se escribe filtrado en
 * una ruta nueva, la bitácora pasa a apuntar a ella y la vieja queda en
 * `archive_garbage` hasta que se borra. Cualquier corte entre dos pasos deja,
 * como mucho, una ruta anotada que la corrida siguiente recoge, y un personaje
 * que sigue pendiente porque `purged_at` solo se escribe al final. Volver a
 * lanzarlo es siempre seguro: un lote que ya no tiene a nadie que quitar no se
 * toca.
 *
 * El índice de rating es otra cosa: se reescribe en su sitio porque siempre se
 * ha reescrito así (ADR 0039, punto 4) y se puede reconstruir desde los lotes.
 */

export interface PurgeOptions {
  /** Purga lo pendiente aunque nada esté cerca de su plazo. */
  force: boolean;
  /** Recorre el archivo y cuenta lo que quitaría, sin escribir nada. */
  dryRun: boolean;
}

export function parsePurgeOptions(args: string[]): PurgeOptions {
  const options: PurgeOptions = { force: false, dryRun: false };
  for (const flag of args) {
    if (flag === "--force") options.force = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else throw new Error(`Opción desconocida: ${flag}. Disponibles: --force, --dry-run.`);
  }
  return options;
}

/** Sufijo de una ruta reescrita por una purga: `.p` y la marca de la corrida. */
const PURGED_SUFFIX = /\.p\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/;

/**
 * La ruta nueva de un lote o de un fichero reescrito.
 *
 * Lleva la marca de la corrida que lo reescribe, y sustituye la de una purga
 * anterior en vez de acumularlas: la ruta dice de qué lote viene y cuándo se
 * purgó por última vez, no su historia entera.
 */
export function purgedPath(path: string, runStartedAt: Date): string {
  const stamp = `.p${archiveRunStamp(runStartedAt)}`;
  const gz = /\.ndjson\.gz$/.exec(path);
  if (gz) {
    const stem = path.slice(0, gz.index).replace(PURGED_SUFFIX, "");
    return `${stem}${stamp}.ndjson.gz`;
  }
  return `${path.replace(PURGED_SUFFIX, "")}${stamp}`;
}

/** Una fila de snapshot tal como está en un lote: `bigint` como texto, fechas en ISO. */
interface ArchivedSnapshot {
  id: string;
  character_id: string;
  captured_at: string;
}

/** Una fila de gear o talentos de un lote: cuelga de un snapshot. */
interface ArchivedChild {
  snapshot_id: string;
}

export interface FilteredBatch {
  snapshots: ArchivedSnapshot[];
  gear: ArchivedChild[];
  talents: ArchivedChild[];
  removedSnapshots: number;
  removedGear: number;
  removedTalents: number;
}

/**
 * Un lote sin las filas de unos personajes. Gear y talentos no llevan el
 * personaje: se quitan los que cuelgan de un snapshot quitado.
 */
export function withoutCharacters(
  batch: { snapshots: ArchivedSnapshot[]; gear: ArchivedChild[]; talents: ArchivedChild[] },
  erased: ReadonlySet<string>,
): FilteredBatch {
  const removedIds = new Set<string>();
  const snapshots = batch.snapshots.filter((row) => {
    if (!erased.has(row.character_id)) return true;
    removedIds.add(String(row.id));
    return false;
  });
  const gear = batch.gear.filter((row) => !removedIds.has(String(row.snapshot_id)));
  const talents = batch.talents.filter((row) => !removedIds.has(String(row.snapshot_id)));
  return {
    snapshots,
    gear,
    talents,
    removedSnapshots: batch.snapshots.length - snapshots.length,
    removedGear: batch.gear.length - gear.length,
    removedTalents: batch.talents.length - talents.length,
  };
}

/**
 * Los ficheros de las temporadas cerradas que llevan personajes. Los demás
 * —segmentos, agregados, cobertura— son de población y no nombran a nadie.
 */
const SEASON_CHARACTER_FILE =
  /^seasons\/s(\d+)\/.+\/(character_activity|character_presence)-\d{4}(\.p[^/]+)?\.ndjson\.gz$/;

export function seasonCharacterFile(
  path: string,
): { seasonId: number; table: "character_activity" | "character_presence" } | null {
  const match = SEASON_CHARACTER_FILE.exec(path);
  if (!match) return null;
  return {
    seasonId: Number(match[1]),
    table: match[2] as "character_activity" | "character_presence",
  };
}

export interface PurgeReport {
  pending: number;
  /** La última prueba de existencia más antigua entre los pendientes. */
  oldestProof: Date | null;
  /** Si no se purgó porque nada estaba cerca de su plazo. */
  skipped: boolean;
  garbage: number;
  batchesScanned: number;
  batchesRewritten: number;
  batchesEmptied: number;
  snapshots: number;
  gearRows: number;
  talentRows: number;
  seasonFilesScanned: number;
  seasonFilesRewritten: number;
  seasonRows: number;
  indexObjects: number;
  indexSeries: number;
  bytesRead: number;
  bytesWritten: number;
}

export async function purgeArchive(args: string[] = []): Promise<void> {
  const options = parsePurgeOptions(args);
  const storage = getArchiveStorage();
  const pool = createPool();
  const client = await pool.connect();
  let locked = false;

  try {
    // Un dry-run solo lee: no recoge basura ni escribe, y no necesita el candado.
    if (!options.dryRun) {
      await takeArchiveLock(client);
      locked = true;
    }
    const report = await purge(client, storage, options, new Date());
    printReport(report, options);
  } finally {
    if (locked) await releaseArchiveLock(client).catch(() => {});
    client.release();
    await pool.end();
  }
}

export async function purge(
  client: pg.PoolClient,
  storage: StorageConfig,
  options: PurgeOptions,
  now: Date,
  fetchFn: Fetch = fetch,
): Promise<PurgeReport> {
  const report: PurgeReport = {
    pending: 0,
    oldestProof: null,
    skipped: false,
    garbage: 0,
    batchesScanned: 0,
    batchesRewritten: 0,
    batchesEmptied: 0,
    snapshots: 0,
    gearRows: 0,
    talentRows: 0,
    seasonFilesScanned: 0,
    seasonFilesRewritten: 0,
    seasonRows: 0,
    indexObjects: 0,
    indexSeries: 0,
    bytesRead: 0,
    bytesWritten: 0,
  };

  // La basura se recoge siempre, haya o no algo que purgar: puede venir de un
  // archivado que se cortó, no solo de una purga.
  if (!options.dryRun) report.garbage = await collectGarbage(client, storage, fetchFn);

  const { rows: pending } = await client.query<{ character_id: string; last_verified_at: Date }>(
    `select character_id, last_verified_at from character_erasures
      where purged_at is null order by last_verified_at`,
  );
  report.pending = pending.length;
  report.oldestProof = pending[0]?.last_verified_at ?? null;
  if (pending.length === 0) return report;

  const due = new Date(now.getTime() - PURGE_AT_DAYS * MS_PER_DAY);
  if (!options.force && !options.dryRun && report.oldestProof && report.oldestProof >= due) {
    report.skipped = true;
    return report;
  }

  const erased = new Set(pending.map((row) => row.character_id));
  const write = !options.dryRun;

  await purgeBatches(client, storage, erased, now, write, report, fetchFn);
  await purgeSeasonFiles(client, storage, erased, now, write, report, fetchFn);
  await purgeRatingIndex(storage, erased, write, report, fetchFn);

  if (write) {
    // Lo viejo de cada lote reescrito está anotado; se borra ya y no en la
    // corrida siguiente, que es lo que la purga ha venido a hacer.
    await collectGarbage(client, storage, fetchFn);
    await client.query(
      `update character_erasures set purged_at = $2
        where character_id = any($1::uuid[]) and purged_at is null`,
      [[...erased], now],
    );
  }

  return report;
}

interface BatchRow {
  object_prefix: string;
  snapshots: number;
  gear_rows: number;
  talent_rows: number;
}

async function download(
  storage: StorageConfig,
  path: string,
  report: PurgeReport,
  fetchFn: Fetch,
): Promise<Buffer | null> {
  const body = await downloadObject(storage, path, fetchFn);
  report.bytesRead += body?.length ?? 0;
  return body;
}

async function purgeBatches(
  client: pg.PoolClient,
  storage: StorageConfig,
  erased: ReadonlySet<string>,
  now: Date,
  write: boolean,
  report: PurgeReport,
  fetchFn: Fetch,
): Promise<void> {
  const { rows: batches } = await client.query<BatchRow>(
    `select object_prefix, snapshots, gear_rows, talent_rows
       from snapshot_archive_batches order by object_prefix`,
  );

  for (const batch of batches) {
    report.batchesScanned++;
    const [snapshotsPath, gearPath, talentsPath] = batchObjectPaths(batch.object_prefix) as [
      string,
      string,
      string,
    ];
    const body = await download(storage, snapshotsPath, report, fetchFn);
    // La bitácora dice que el lote existe: si no está, algo más grave que un
    // personaje pendiente se ha roto, y seguir lo taparía.
    if (!body) {
      throw new Error(`El lote ${batch.object_prefix} está en la bitácora y no en Storage.`);
    }
    const snapshots = decodeRows<ArchivedSnapshot>(body);
    if (!snapshots.some((row) => erased.has(row.character_id))) continue;

    // Solo se bajan gear y talentos de un lote que hay que reescribir: son la
    // mayor parte de sus bytes y no dicen de quién son sin los snapshots.
    const readChildren = async (path: string, expected: number): Promise<ArchivedChild[]> => {
      if (expected === 0) return [];
      const child = await download(storage, path, report, fetchFn);
      if (!child) throw new Error(`Falta ${path}, que la bitácora cuenta con ${expected} filas.`);
      return decodeRows<ArchivedChild>(child);
    };
    const filtered = withoutCharacters(
      {
        snapshots,
        gear: await readChildren(gearPath, batch.gear_rows),
        talents: await readChildren(talentsPath, batch.talent_rows),
      },
      erased,
    );

    report.batchesRewritten++;
    report.snapshots += filtered.removedSnapshots;
    report.gearRows += filtered.removedGear;
    report.talentRows += filtered.removedTalents;
    if (filtered.snapshots.length === 0) report.batchesEmptied++;
    if (!write) continue;

    await rewriteBatch(client, storage, batch, filtered, now, report, fetchFn);
  }
}

async function rewriteBatch(
  client: pg.PoolClient,
  storage: StorageConfig,
  batch: BatchRow,
  filtered: FilteredBatch,
  now: Date,
  report: PurgeReport,
  fetchFn: Fetch,
): Promise<void> {
  const oldPaths = batchObjectPaths(batch.object_prefix);
  const empty = filtered.snapshots.length === 0;
  const prefix = purgedPath(batch.object_prefix, now);
  const newPaths = empty ? [] : batchObjectPaths(prefix);

  // Lo nuevo se anota antes de subir, fuera de la transacción: si la subida se
  // corta, lo subido a medias queda anotado y no huérfano.
  await noteGarbage(client, newPaths);
  const contents: readonly object[][] = [filtered.snapshots, filtered.gear, filtered.talents];
  for (const [index, path] of newPaths.entries()) {
    const rows = contents[index] ?? [];
    if (rows.length === 0) continue;
    const body = encodeRows(rows);
    await uploadObject(storage, path, body, {}, fetchFn);
    report.bytesWritten += body.length;
  }

  const captured = filtered.snapshots.map((row) => new Date(row.captured_at).getTime());
  await client.query("begin");
  try {
    await forgetGarbage(client, newPaths);
    await noteGarbage(client, oldPaths);
    const changed = empty
      ? await client.query("delete from snapshot_archive_batches where object_prefix = $1", [
          batch.object_prefix,
        ])
      : await client.query(
          `update snapshot_archive_batches
              set object_prefix = $2, snapshots = $3, gear_rows = $4, talent_rows = $5,
                  first_captured_at = $6, last_captured_at = $7
            where object_prefix = $1`,
          [
            batch.object_prefix,
            prefix,
            filtered.snapshots.length,
            filtered.gear.length,
            filtered.talents.length,
            new Date(Math.min(...captured)),
            new Date(Math.max(...captured)),
          ],
        );
    if (changed.rowCount !== 1) {
      throw new Error(`El lote ${batch.object_prefix} ha desaparecido de la bitácora a medias.`);
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

async function purgeSeasonFiles(
  client: pg.PoolClient,
  storage: StorageConfig,
  erased: ReadonlySet<string>,
  now: Date,
  write: boolean,
  report: PurgeReport,
  fetchFn: Fetch,
): Promise<void> {
  // Aquí sí se lista el bucket: `archived_seasons` solo guarda la carpeta de la
  // última corrida que tocó cada temporada, y una temporada puede tener restos
  // de varias.
  for (const path of await listObjects(storage, "seasons", fetchFn)) {
    const file = seasonCharacterFile(path);
    if (!file) continue;
    report.seasonFilesScanned++;

    const body = await download(storage, path, report, fetchFn);
    if (!body) continue;
    const rows = decodeRows<{ character_id: string }>(body);
    const kept = rows.filter((row) => !erased.has(row.character_id));
    const removed = rows.length - kept.length;
    if (removed === 0) continue;

    report.seasonFilesRewritten++;
    report.seasonRows += removed;
    if (!write) continue;

    const target = kept.length === 0 ? null : purgedPath(path, now);
    if (target) {
      await noteGarbage(client, [target]);
      const encoded = encodeRows(kept);
      await uploadObject(storage, target, encoded, {}, fetchFn);
      report.bytesWritten += encoded.length;
    }

    const column = file.table === "character_activity" ? "activity_rows" : "presence_rows";
    await client.query("begin");
    try {
      if (target) await forgetGarbage(client, [target]);
      await noteGarbage(client, [path]);
      // La bitácora de la temporada cuenta lo que hay en el archivo, y ahora
      // hay menos.
      await client.query(
        `update archived_seasons set ${column} = greatest(${column} - $2, 0)
          where season_id = $1`,
        [file.seasonId, removed],
      );
      await client.query("commit");
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    }
  }
}

/** La temporada y el shard de un objeto del índice, o null si no lo es. */
export function ratingIndexObject(path: string): { seasonId: number; shard: string } | null {
  const match = new RegExp(`^${RATING_HISTORY_PREFIX}/s(\\d+)/([0-9a-f]{2})\\.json\\.gz$`).exec(
    path,
  );
  return match ? { seasonId: Number(match[1]), shard: match[2] as string } : null;
}

async function purgeRatingIndex(
  storage: StorageConfig,
  erased: ReadonlySet<string>,
  write: boolean,
  report: PurgeReport,
  fetchFn: Fetch,
): Promise<void> {
  // Solo los shards donde puede estar alguno: el id decide el shard, y de 256
  // por temporada un puñado de borrados toca unos pocos.
  const shards = new Set([...erased].map(ratingHistoryShard));

  for (const path of await listObjects(storage, RATING_HISTORY_PREFIX, fetchFn)) {
    const object = ratingIndexObject(path);
    if (!object || !shards.has(object.shard)) continue;

    const shard = await readRatingHistoryShard(storage, object.seasonId, object.shard, fetchFn);
    if (!shard) continue;
    const removed = removeCharactersFromShard(shard, erased);
    if (removed === 0) continue;

    report.indexObjects++;
    report.indexSeries += removed;
    if (write) report.bytesWritten += await writeRatingHistoryShard(storage, shard, fetchFn);
  }
}

const fmt = (value: number): string => value.toLocaleString("es-ES");
const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

function printReport(report: PurgeReport, options: PurgeOptions): void {
  if (report.garbage > 0) console.log(`${fmt(report.garbage)} objetos sobrantes borrados.`);

  if (report.pending === 0) {
    console.log("Ningún personaje borrado pendiente de sacar del archivo.");
    return;
  }
  const oldest = report.oldestProof?.toISOString() ?? "—";
  if (report.skipped) {
    console.log(
      `${fmt(report.pending)} personajes borrados esperan a la purga; la prueba de existencia ` +
        `más antigua es del ${oldest} y se purga a los ${PURGE_AT_DAYS} días (--force para no esperar).`,
    );
    return;
  }

  console.log(
    `${fmt(report.pending)} personajes borrados; prueba de existencia más antigua: ${oldest}.`,
  );
  console.log(
    `Lotes: ${fmt(report.batchesRewritten)} de ${fmt(report.batchesScanned)} con alguno ` +
      `(${fmt(report.batchesEmptied)} quedan vacíos): ${fmt(report.snapshots)} snapshots, ` +
      `${fmt(report.gearRows)} gear y ${fmt(report.talentRows)} talentos.`,
  );
  console.log(
    `Temporadas cerradas: ${fmt(report.seasonFilesRewritten)} de ` +
      `${fmt(report.seasonFilesScanned)} ficheros, ${fmt(report.seasonRows)} filas.`,
  );
  console.log(
    `Índice de rating: ${fmt(report.indexSeries)} series en ${fmt(report.indexObjects)} objetos.`,
  );
  console.log(`Leído ${mb(report.bytesRead)}, escrito ${mb(report.bytesWritten)}.`);
  if (options.dryRun) console.log("\n--dry-run: no se ha escrito ni borrado nada.");
}
