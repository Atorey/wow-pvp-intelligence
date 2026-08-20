import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import { LEADERBOARD_DIR, getLeaderboardRetentionDays } from "../config";
import { createPool } from "../db/pool";
import { fetchLeaderboardBatch, printBatch, type FetchedLeaderboard } from "./fetch-leaderboard";
import { ingestFile, printDistribution } from "./ingest-leaderboard";

/**
 * Job programado del leaderboard (§28 del plan): descarga e ingesta en la misma
 * ejecución. Van juntas a propósito — el runner es efímero (GitHub Actions, ver
 * ADR 0004), así que un fetch sin su ingesta deja el trabajo perdido en un disco
 * que desaparece al terminar la corrida.
 *
 * Preguntamos cada 3h porque es la cadencia que fuentes de terceros atribuyen a
 * Blizzard, pero la asunción no se da por buena: se ingiere solo cuando cambia
 * la **población** descargada —no cuando cambia el payload, que se mueve por el
 * rank y por campos que ni guardamos (#53, ADR 0009)— y cada observación queda
 * registrada para poder medir la cadencia real.
 */

const MS_PER_HOUR = 3_600_000;

/** Una descarga ya resuelta contra lo que había en la bitácora. */
interface RefreshOutcome {
  result: FetchedLeaderboard;
  changed: boolean;
  snapshots: number;
  redundant: number;
}

/**
 * Última huella no nula de cada bracket.
 *
 * Son dos y no una desde #53, y miden cosas distintas: `content_hash` dice si
 * Blizzard republicó (la cadencia para la que nació la bitácora, ADR 0004) y
 * `population_hash` dice si cambió alguien, que es lo único que justifica
 * ingerir. Se filtran los nulos porque null es "no se pudo mirar" o "la ingesta
 * falló": darlo por bueno haría que el bracket no se reintentara.
 */
async function lastHashByBracket(
  pool: pg.Pool,
  region: string,
  column: "content_hash" | "population_hash",
): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ bracket: string; hash: string }>(
    `select distinct on (bracket) bracket, ${column} as hash
       from leaderboard_fetches
      where region = $1 and ${column} is not null
      order by bracket, fetched_at desc`,
    [region],
  );
  return new Map(rows.map((r) => [r.bracket, r.hash]));
}

// -- Cadencia --------------------------------------------------------------

export interface CadenceRow {
  bracket: string;
  fetched_at: Date;
}

export interface CadenceSummary {
  bracket: string;
  /** Publicaciones distintas observadas. Los intervalos son uno menos. */
  changes: number;
  medianHours: number | null;
  minHours: number | null;
  maxHours: number | null;
}

/**
 * Intervalos entre publicaciones distintas, por bracket. Es la medición que
 * §28 dejó pendiente ("~3h aprox., a confirmar"): el tiempo entre dos cambios
 * de contenido acota por arriba la cadencia real de Blizzard — nunca la
 * subestima, porque solo miramos cada 3h y un cambio podría llevar rato ahí.
 *
 * Espera filas ya filtradas a `changed = true` y ordenadas por fecha ascendente.
 */
export function summarizeCadence(rows: CadenceRow[]): CadenceSummary[] {
  const byBracket = new Map<string, Date[]>();
  for (const row of rows) {
    const dates = byBracket.get(row.bracket) ?? [];
    dates.push(row.fetched_at);
    byBracket.set(row.bracket, dates);
  }

  return [...byBracket]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([bracket, dates]) => {
      const gaps: number[] = [];
      for (let i = 1; i < dates.length; i++) {
        // noUncheckedIndexedAccess: el bucle garantiza ambos, pero TS no lo sabe.
        const prev = dates[i - 1];
        const curr = dates[i];
        if (prev && curr) gaps.push((curr.getTime() - prev.getTime()) / MS_PER_HOUR);
      }

      if (gaps.length === 0) {
        return {
          bracket,
          changes: dates.length,
          medianHours: null,
          minHours: null,
          maxHours: null,
        };
      }

      const sorted = [...gaps].sort((a, b) => a - b);
      const mid = Math.floor(sorted.length / 2);
      const median =
        sorted.length % 2 === 1
          ? (sorted[mid] as number)
          : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;

      return {
        bracket,
        changes: dates.length,
        medianHours: median,
        minHours: sorted[0] as number,
        maxHours: sorted[sorted.length - 1] as number,
      };
    });
}

/**
 * Dos cadencias, no una (#53). Cada cuánto **publica** Blizzard es la medición
 * que §28 dejó pendiente y para la que nació la bitácora; cada cuánto **cambia
 * la población** es lo que de verdad marca el ritmo al que crece el histórico, y
 * por tanto el número con el que se decide el cron y la retención (#48). Que
 * fueran lo mismo era precisamente el error que este issue corrige.
 */
async function printCadence(pool: pg.Pool, region: string): Promise<void> {
  const load = async (condition: string): Promise<CadenceSummary[]> => {
    const { rows } = await pool.query<CadenceRow>(
      `select bracket, fetched_at
         from leaderboard_fetches
        where region = $1 and ${condition}
        order by bracket, fetched_at asc`,
      [region],
    );
    return summarizeCadence(rows).filter((s) => s.medianHours !== null);
  };

  const fmt = (h: number | null): string => (h === null ? "—" : `${h.toFixed(1)}h`);
  const print = (title: string, unit: string, summaries: CadenceSummary[]): void => {
    if (summaries.length === 0) return;
    console.log(`\n=== ${title} ===`);
    console.log("(cota superior: solo miramos cada 3h, así que el valor real puede ser menor)\n");
    for (const s of summaries) {
      console.log(
        `  ${s.bracket}: mediana ${fmt(s.medianHours)} ` +
          `(min ${fmt(s.minHours)}, max ${fmt(s.maxHours)}, ${s.changes} ${unit})`,
      );
    }
  };

  const published = await load("published");
  const changed = await load("changed");

  if (published.length === 0 && changed.length === 0) {
    console.log("\nCadencia observada: todavía no hay dos publicaciones distintas que comparar.");
    return;
  }

  print("CADENCIA OBSERVADA DE PUBLICACIÓN", "publicaciones", published);
  print("CADENCIA OBSERVADA DE CAMBIO DE POBLACIÓN", "cambios", changed);
}

// -- Retención -------------------------------------------------------------

/** Extrae la marca temporal UTC del nombre de archivo (`...-20260816T063012.json`). */
function fileTimestamp(name: string): Date | null {
  const match = /-(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.json$/.exec(name);
  if (!match) return null;
  const [, y, mo, d, h, mi, s] = match;
  return new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}Z`);
}

/**
 * Archivos que ya no hace falta conservar. Los que no siguen el patrón de
 * nombre se dejan estar: son de otra cosa o de otra versión del pipeline, y
 * borrar lo que no reconocemos es peor que ocupar disco.
 */
export function filesToPrune(names: string[], now: Date, retentionDays: number): string[] {
  const cutoff = now.getTime() - retentionDays * 24 * MS_PER_HOUR;
  return names.filter((name) => {
    const stamp = fileTimestamp(name);
    return stamp !== null && stamp.getTime() < cutoff;
  });
}

function prune(now: Date): number {
  const retentionDays = getLeaderboardRetentionDays();
  if (!fs.existsSync(LEADERBOARD_DIR)) return 0;

  const stale = filesToPrune(fs.readdirSync(LEADERBOARD_DIR), now, retentionDays);
  for (const name of stale) fs.rmSync(path.join(LEADERBOARD_DIR, name), { force: true });
  return stale.length;
}

// -- Job -------------------------------------------------------------------

export async function refreshLeaderboard(): Promise<void> {
  console.log("Job programado de leaderboard — descarga + ingesta\n");

  const batch = await fetchLeaderboardBatch();
  console.log(`Región: ${batch.region.toUpperCase()} — temporada actual: ${batch.seasonId}`);
  printBatch(batch);

  const pool = createPool();
  try {
    const previousContent = await lastHashByBracket(pool, batch.region, "content_hash");
    const previousPopulation = await lastHashByBracket(pool, batch.region, "population_hash");
    const outcomes: RefreshOutcome[] = [];
    const failures: string[] = [];

    console.log("\n=== INGESTA ===\n");
    for (const result of batch.results) {
      if (!result.file) {
        // No se pudo mirar. Se registra igual: un hueco en la bitácora sin
        // explicación se confundiría después con "Blizzard no publicó nada".
        await recordFetch(pool, batch, result, { changed: false, published: null, snapshots: 0 });
        console.log(`→ ${result.spec}: descarga fallida, no se ingiere`);
        outcomes.push({ result, changed: false, snapshots: 0, redundant: 0 });
        continue;
      }

      // Publicar y cambiar de población no son lo mismo (#53): el payload se
      // mueve por el rank, por el envoltorio y por campos que ni ingerimos. Lo
      // primero se registra como observación de cadencia; solo lo segundo
      // justifica escribir en el histórico.
      //
      // Los brackets sin population_hash previo (los de antes de esta migración)
      // no están en el mapa, así que cuentan como cambio y se ingieren una vez.
      // No hace falta tratarlos aparte: el filtro por fila de `ingestFile`
      // absorbe esa ingesta escribiendo cero filas.
      const published = previousContent.get(result.bracket) !== result.file.hash;
      const changed = previousPopulation.get(result.bracket) !== result.file.populationHash;

      if (!changed) {
        // Nadie ha entrado, salido ni movido rating o partidas. Ingerirlo
        // crearía una fila por personaje con captured_at nuevo y datos
        // idénticos, que es lo que hace inútil un histórico append-only.
        fs.rmSync(result.file.path, { force: true });
        await recordFetch(pool, batch, result, { changed: false, published, snapshots: 0 });
        const detail = published
          ? "republicado pero sin cambios de población"
          : "sin cambios desde la última descarga";
        console.log(`→ ${result.spec}: ${detail}, no se ingiere`);
        outcomes.push({ result, changed: false, snapshots: 0, redundant: 0 });
        continue;
      }

      try {
        const { snapshots, redundant } = await ingestFile(pool, batch.region, result.file.content);
        await recordFetch(pool, batch, result, { changed: true, published, snapshots, redundant });
        console.log(
          `→ ${result.spec}: población nueva, ${snapshots} snapshots insertados ` +
            `(${redundant} entradas sin cambio, descartadas)`,
        );
        outcomes.push({ result, changed: true, snapshots, redundant });
      } catch (err) {
        // Una spec que revienta no puede llevarse por delante a las otras 39. Son
        // 39 transacciones independientes y el runner es efímero (ADR 0004): lo que
        // no se ingiere aquí no se reintenta, se pierde esa publicación entera.
        //
        // Se anota con population_hash null a propósito: la comparación de la
        // corrida siguiente mira el último hash no nulo, así que guardar el de
        // una ingesta fallida daría el bracket por ingerido y no se reintentaría.
        // El content_hash sí se conserva: la publicación se vio, y eso es cierto
        // aunque la ingesta fallara.
        const reason = err instanceof Error ? err.message : String(err);
        failures.push(`${result.spec}: ${reason}`);
        await recordFetch(pool, batch, result, {
          changed: false,
          published,
          snapshots: 0,
          populationHash: null,
          note: `ingesta fallida — ${reason}`,
        });
        console.error(`→ ${result.spec}: ❌ la ingesta falló (${reason})`);
        outcomes.push({ result, changed: false, snapshots: 0, redundant: 0 });
      }
    }

    if (outcomes.every((o) => !o.result.file)) {
      throw new Error(
        "Ninguna spec se pudo descargar. Revisa credenciales, cuota o estado de la API de Blizzard.",
      );
    }

    const changedCount = outcomes.filter((o) => o.changed).length;
    const total = outcomes.reduce((acc, o) => acc + o.snapshots, 0);
    const redundant = outcomes.reduce((acc, o) => acc + o.redundant, 0);
    console.log(
      `\n${changedCount}/${outcomes.length} brackets con cambio de población — ` +
        `${total} snapshots insertados, ${redundant} entradas descartadas por no cambiar nada.`,
    );

    const pruned = prune(new Date(batch.fetchedAt));
    if (pruned > 0) console.log(`Retención: ${pruned} archivo(s) antiguos borrados de disco.`);

    // La distribución solo cambia si entró población nueva; imprimirla en cada
    // corrida llenaría el log del job con la misma tabla ocho veces al día.
    if (changedCount > 0) await printDistribution(pool);

    await printCadence(pool, batch.region);

    // El job termina en rojo si algo falló, pero después de haber ingerido todo lo
    // demás: una corrida a medias que se anuncia verde es peor que una que falla.
    if (failures.length > 0) {
      throw new Error(`${failures.length} spec(s) no se pudieron ingerir: ${failures.join(" | ")}`);
    }
  } finally {
    await pool.end();
  }
}

async function recordFetch(
  pool: pg.Pool,
  batch: { region: string; seasonId: number; fetchedAt: string },
  result: FetchedLeaderboard,
  {
    changed,
    published,
    snapshots,
    redundant,
    populationHash,
    note,
  }: {
    /** ¿Cambió la población, y por tanto se ingirió? */
    changed: boolean;
    /** ¿Republicó Blizzard? null = no se pudo mirar (regla 5). */
    published: boolean | null;
    snapshots: number;
    redundant?: number;
    /** Explícito a null cuando la ingesta falló: ver el catch del job. */
    populationHash?: string | null;
    note?: string | null;
  },
): Promise<void> {
  await pool.query(
    `insert into leaderboard_fetches
       (region, season_id, bracket, fetched_at, content_hash, population_hash, entry_count,
        changed, published, ingested_snapshots, redundant_entries, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      batch.region,
      batch.seasonId,
      result.bracket,
      batch.fetchedAt,
      result.file?.hash ?? null,
      populationHash === undefined ? (result.file?.populationHash ?? null) : populationHash,
      result.entries,
      changed,
      published,
      snapshots,
      redundant ?? 0,
      note ?? result.warning,
    ],
  );
}
