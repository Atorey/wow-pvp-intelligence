import type pg from "pg";
import { ACTIVITY_WINDOWS } from "@wowpvp/core";
import { getArchiveStorage } from "../config";
import { createPool } from "../db/pool";
import { ensureBucket, uploadObject, type StorageConfig } from "@wowpvp/storage";
import { encodeRows } from "../storage";
import { indexRatingHistory, toObservation, type RatingRow } from "./rating-history";

/**
 * Archivado del histórico frío de `character_snapshots` (ADR 0034).
 *
 * Lo anterior a la ventana se vuelca a Supabase Storage y se borra de Postgres,
 * con sus filas de gear y talentos, que caen por cascada. Revisa el ADR 0002 sin
 * derogarlo: nada se actualiza y nada se pierde, pero el append-only pasa a vivir
 * en dos almacenes.
 *
 * Lo que **no** se archiva, aunque sea viejo, es lo que alguien sigue leyendo.
 * Por cada serie `(personaje, bracket, temporada)` se quedan calientes:
 *
 * - **el ancla**: la última fila anterior al corte de cada origen. La usan la
 *   ingesta por cambio (ADR 0009) para decidir si una fila nueva cambia algo, el
 *   recálculo de actividad para medir la primera subida dentro de la ventana, y
 *   la ficha del jugador, que enseña la última observación aunque sea de hace dos
 *   meses. Sin ella, el perfil de quien dejó de jugar se quedaría en blanco;
 * - **la última con gear y la última con talentos**: la ficha los busca así
 *   (`readLatestGear`, `readLatestTalents`), y casi nunca son la última fila,
 *   que suele ser de leaderboard;
 * - **el pico**: `readPeakRating` es el máximo de la temporada entera.
 *
 * Y solo se archiva lo que `character_activity` ya había visto —filas anteriores
 * al último cálculo de su serie—, porque desde aquí la actividad hereda de esa
 * fila lo que ya no puede leer (`withArchivedActivity` en core).
 *
 * Lo que se archiva deja además su rating en el índice por personaje del
 * histórico (ADR 0039), antes del primer borrado: el archivo son lotes por
 * fecha con la población entera, y la web no puede leer de ahí la temporada de
 * una sola persona.
 *
 * Cada lote es autónomo: se sube y **después** se borra, en ese orden. Si algo
 * falla entre medias, lo peor que queda es un lote subido dos veces; el archivo
 * se deduplica por `id` al leerlo. Lo contrario —borrar sin copia— no puede
 * pasar.
 */

/** Filas de `character_snapshots` por lote: holgado bajo el tope de 50 MB por objeto. */
const DEFAULT_BATCH = 20_000;

const MS_PER_DAY = 86_400_000;

export interface Options {
  /** Días que se quedan en Postgres. Nunca menos que la ventana de los agregados. */
  days: number;
  /** Snapshots por lote subido. */
  batch: number;
  /** Cuenta lo que archivaría, sin subir ni borrar nada. */
  dryRun: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    days: ACTIVITY_WINDOWS.fallback,
    batch: DEFAULT_BATCH,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag === "--days" || flag === "--batch") {
      const raw = args[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${flag} pide un entero positivo, no ${raw}.`);
      }
      if (flag === "--days") options.days = value;
      else options.batch = value;
      continue;
    }
    throw new Error(`Opción desconocida: ${flag}. Disponibles: --days, --batch, --dry-run.`);
  }

  // La ventana más larga con la que se agrega es la de 14 días (§13.4): con
  // menos, el siguiente `refresh-aggregates --window 14` contaría una población
  // a la que le falta parte sin que nada lo avisara.
  if (options.days < ACTIVITY_WINDOWS.fallback) {
    throw new Error(
      `--days=${options.days} deja fuera parte de la ventana de actividad de ` +
        `${ACTIVITY_WINDOWS.fallback} días con la que se calculan los agregados.`,
    );
  }

  return options;
}

/** Carpeta de un lote dentro del bucket. Sin `:`, que Storage no admite en una clave. */
export function batchPrefix(runStartedAt: Date, index: number): string {
  const run = runStartedAt
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z")
    .replace(/:/g, "-");
  return `${run}/${String(index + 1).padStart(4, "0")}`;
}

/**
 * Las filas que se archivan, materializadas una sola vez en una tabla temporal.
 *
 * Una sola vez porque decidir qué se queda es una consulta sobre la tabla entera
 * (el pico y el último gear miran toda la temporada), y repetirla por lote la
 * pagaría cincuenta veces. Y temporal porque vive y muere con la conexión: no
 * deja nada que limpiar si la corrida se corta.
 *
 * El `join` con `character_activity` es la segunda condición de
 * `withArchivedActivity`: una fila que el último cálculo de su serie no vio se
 * queda hasta el siguiente, o lo que dijera de la actividad se perdería con ella.
 */
function candidatesSql(cutoff: Date): string {
  return `
  create temp table archive_candidates as
  with old as (
    select id, character_id, bracket, season_id, source, captured_at
      from character_snapshots
     where captured_at < ${sqlTimestamp(cutoff)}
  ),
  keep as (
    select * from (
      select distinct on (character_id, bracket, season_id, source) id
        from old
       order by character_id, bracket, season_id, source, captured_at desc
    ) anchor
    union
    select * from (
      select distinct on (s.character_id, s.bracket, s.season_id) s.id
        from character_snapshots s
       where exists (select 1 from character_snapshot_gear g where g.snapshot_id = s.id)
       order by s.character_id, s.bracket, s.season_id, s.captured_at desc
    ) last_gear
    union
    select * from (
      select distinct on (s.character_id, s.bracket, s.season_id) s.id
        from character_snapshots s
       where exists (select 1 from character_snapshot_talents t where t.snapshot_id = s.id)
       order by s.character_id, s.bracket, s.season_id, s.captured_at desc
    ) last_talents
    union
    select * from (
      select distinct on (character_id, bracket, season_id) id
        from character_snapshots
       order by character_id, bracket, season_id, rating desc, captured_at desc
    ) peak
  )
  select o.id
    from old o
    join character_activity a
      on a.character_id = o.character_id and a.bracket = o.bracket
     and a.season_id = o.season_id and a.computed_at > o.captured_at
   where not exists (select 1 from keep k where k.id = o.id)
`;
}

/**
 * El corte escrito como literal: `create table as` es una sentencia de utilidad y
 * no acepta parámetros. Sale de un `Date` del propio job, nunca de fuera, y
 * `toISOString()` no puede producir una comilla.
 */
export function sqlTimestamp(date: Date): string {
  return `'${date.toISOString()}'::timestamptz`;
}

export interface ArchiveReport {
  cutoff: Date;
  /** Filas anteriores al corte. */
  old: number;
  /** De ellas, las que se archivan (o se archivarían, en dry-run). */
  candidates: number;
  /** Anteriores al corte que el último cálculo de actividad no vio: esperan al siguiente. */
  unseenByActivity: number;
  batches: number;
  snapshots: number;
  gearRows: number;
  talentRows: number;
  bytes: number;
  /** Objetos del índice de rating reescritos antes de borrar (ADR 0039). */
  historyObjects: number;
}

export async function archiveSnapshots(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  // La configuración de Storage se pide antes de tocar la base: una corrida que
  // no puede subir nada tiene que fallar antes de gastar minutos en calcular
  // qué subiría.
  const storage = options.dryRun ? null : getArchiveStorage();
  const pool = createPool();

  try {
    const report = await archive(pool, storage, options, new Date());
    printReport(report, options);
  } finally {
    await pool.end();
  }
}

/** `storage` null es dry-run: se calcula y se cuenta, no se sube ni se borra. */
export async function archive(
  pool: pg.Pool,
  storage: StorageConfig | null,
  options: Pick<Options, "days" | "batch">,
  now: Date,
): Promise<ArchiveReport> {
  const cutoff = new Date(now.getTime() - options.days * MS_PER_DAY);
  const client = await pool.connect();

  try {
    // La selección recorre la tabla entera; con el statement_timeout del
    // pooler de Supabase no llega a terminar.
    await client.query("set statement_timeout = 0");
    await client.query("drop table if exists archive_candidates");
    await client.query(candidatesSql(cutoff));
    await client.query("create index on archive_candidates (id)");

    const { rows: counts } = await client.query<{
      old: string;
      candidates: string;
      unseen: string;
    }>(
      `select (select count(*) from character_snapshots where captured_at < $1) as old,
              (select count(*) from archive_candidates) as candidates,
              (select count(*)
                 from character_snapshots s
                where s.captured_at < $1
                  and not exists (
                        select 1 from character_activity a
                         where a.character_id = s.character_id and a.bracket = s.bracket
                           and a.season_id = s.season_id and a.computed_at > s.captured_at)
              ) as unseen`,
      [cutoff],
    );

    const report: ArchiveReport = {
      cutoff,
      old: Number(counts[0]?.old ?? 0),
      candidates: Number(counts[0]?.candidates ?? 0),
      unseenByActivity: Number(counts[0]?.unseen ?? 0),
      batches: 0,
      snapshots: 0,
      gearRows: 0,
      talentRows: 0,
      bytes: 0,
      historyObjects: 0,
    };

    if (!storage || report.candidates === 0) return report;
    await ensureBucket(storage);

    // El índice del histórico de rating va **antes** que el primer borrado: es
    // la única copia que la web puede leer de estas filas (ADR 0039). Si falla
    // aquí no se ha borrado nada; si falla después, las filas indexadas siguen
    // calientes y la web las une sin contarlas dos veces.
    const { rows: ratings } = await client.query<RatingRow>(
      `select s.character_id, s.bracket, s.season_id, s.captured_at, s.rating
         from character_snapshots s
         join archive_candidates c on c.id = s.id`,
    );
    const indexed = await indexRatingHistory(storage, ratings.map(toObservation));
    report.historyObjects = indexed.objects;
    console.log(
      `  Índice de rating: ${fmt(ratings.length)} observaciones en ${fmt(indexed.objects)} ` +
        `objetos (${mb(indexed.bytes)})`,
    );

    for (;;) {
      // Siempre desde el principio: cada lote se borra de la tabla temporal al
      // confirmarse, así que lo que queda en ella es exactamente lo pendiente.
      const { rows: ids } = await client.query<{ id: string }>(
        `select id from archive_candidates order by id limit $1`,
        [options.batch],
      );
      if (ids.length === 0) break;

      const prefix = batchPrefix(now, report.batches);
      const archived = await archiveBatch(
        client,
        storage,
        prefix,
        cutoff,
        ids.map((row) => row.id),
      );
      report.batches++;
      report.snapshots += archived.snapshots;
      report.gearRows += archived.gearRows;
      report.talentRows += archived.talentRows;
      report.bytes += archived.bytes;
      console.log(
        `  ${prefix}: ${fmt(archived.snapshots)} snapshots, ${fmt(archived.gearRows)} gear, ` +
          `${fmt(archived.talentRows)} talentos (${mb(archived.bytes)})`,
      );
    }

    return report;
  } finally {
    await client.query("drop table if exists archive_candidates").catch(() => {});
    client.release();
  }
}

interface BatchResult {
  snapshots: number;
  gearRows: number;
  talentRows: number;
  bytes: number;
}

async function archiveBatch(
  client: pg.PoolClient,
  storage: StorageConfig,
  prefix: string,
  cutoff: Date,
  ids: readonly string[],
): Promise<BatchResult> {
  // `select *` a propósito: el archivo es una copia de la fila, y una columna que
  // se añada mañana tiene que acabar en él sin que nadie se acuerde de este job.
  const { rows: snapshots } = await client.query<{ captured_at: Date }>(
    `select * from character_snapshots where id = any($1::bigint[]) order by id`,
    [ids],
  );
  const { rows: gear } = await client.query<object>(
    `select * from character_snapshot_gear where snapshot_id = any($1::bigint[])
      order by snapshot_id, slot`,
    [ids],
  );
  // Lo que se sube son `label_ids`, no nombres (ADR 0035): este lote no se
  // entiende sin `talent_labels`, que por eso no se poda nunca. Es la primera
  // dependencia del archivo hacia una tabla viva.
  const { rows: talents } = await client.query<object>(
    `select * from character_snapshot_talents where snapshot_id = any($1::bigint[])
      order by snapshot_id`,
    [ids],
  );

  const files: [string, readonly object[]][] = [
    ["character_snapshots", snapshots],
    ["character_snapshot_gear", gear],
    ["character_snapshot_talents", talents],
  ];

  let bytes = 0;
  for (const [table, rows] of files) {
    if (rows.length === 0) continue;
    const body = encodeRows(rows);
    await uploadObject(storage, `${prefix}/${table}.ndjson.gz`, body);
    bytes += body.length;
  }

  const captured = snapshots.map((row) => row.captured_at.getTime());

  // Todo lo que borra va en una transacción con lo que lo cuenta: si el
  // recuento de `archived_observations` y el borrado pudieran separarse, la
  // actividad perdería observaciones o las contaría dos veces.
  await client.query("begin");
  try {
    await client.query(
      `update character_activity a
          set archived_observations = a.archived_observations + x.n
         from (select character_id, bracket, season_id, count(*)::int as n
                 from character_snapshots
                where id = any($1::bigint[])
                group by character_id, bracket, season_id) x
        where a.character_id = x.character_id and a.bracket = x.bracket
          and a.season_id = x.season_id`,
      [ids],
    );
    const deleted = await client.query(
      `delete from character_snapshots where id = any($1::bigint[])`,
      [ids],
    );
    if (deleted.rowCount !== snapshots.length) {
      throw new Error(
        `El lote ${prefix} subió ${snapshots.length} snapshots y el borrado alcanzó ` +
          `${deleted.rowCount}: se deshace para no borrar nada que no esté en el archivo.`,
      );
    }
    await client.query(
      `insert into snapshot_archive_batches
         (object_prefix, cutoff, snapshots, gear_rows, talent_rows,
          first_captured_at, last_captured_at)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        prefix,
        cutoff,
        snapshots.length,
        gear.length,
        talents.length,
        new Date(Math.min(...captured)),
        new Date(Math.max(...captured)),
      ],
    );
    await client.query("delete from archive_candidates where id = any($1::bigint[])", [ids]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }

  return {
    snapshots: snapshots.length,
    gearRows: gear.length,
    talentRows: talents.length,
    bytes,
  };
}

const fmt = (value: number): string => value.toLocaleString("es-ES");
const mb = (bytes: number): string => `${(bytes / 1_048_576).toFixed(1)} MB`;

function printReport(report: ArchiveReport, options: Options): void {
  console.log(`\nCorte: ${report.cutoff.toISOString()} (${options.days} días calientes)`);
  console.log(
    `${fmt(report.old)} snapshots anteriores al corte: ${fmt(report.candidates)} archivables y ` +
      `${fmt(report.old - report.candidates)} que se quedan (ancla, último gear, últimos ` +
      `talentos, pico, o aún no vistas por la actividad).`,
  );
  if (report.unseenByActivity > 0) {
    console.log(
      `  ${fmt(report.unseenByActivity)} de ellas esperan a que refresh-activity las vea; ` +
        `si son de una temporada que ya no se recalcula, ejecútalo con --season.`,
    );
  }

  if (options.dryRun) {
    console.log("\n--dry-run: no se ha subido ni borrado nada.");
    return;
  }

  console.log(
    `\nArchivado: ${fmt(report.snapshots)} snapshots, ${fmt(report.gearRows)} gear y ` +
      `${fmt(report.talentRows)} talentos en ${report.batches} lotes (${mb(report.bytes)}).`,
  );
  if (report.snapshots > 0) {
    console.log(
      "Las inserciones siguientes reutilizan el hueco, pero la tabla no encoge sola: tras un " +
        "archivado grande hace falta un VACUUM FULL manual para que baje la cuota (ADR 0034).",
    );
  }
}
