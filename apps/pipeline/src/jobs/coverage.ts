import type pg from "pg";
import {
  DEFAULT_SEGMENT_SCALE,
  formatSegment,
  rollUpCoverage,
  type ActivityWindowDays,
  type CoveragePair,
  type RatingSegment,
} from "@wowpvp/core";
import { getRegion } from "../config";
import { createPool } from "../db/pool";

/**
 * Lectura de la cobertura servible por par `(spec, segmento objetivo)` (ADR 0032).
 *
 * `refresh-aggregates` la calcula y la guarda; esto es lo que la mira. Son dos
 * comandos y no uno porque la pregunta de este no es "cómo ha ido la corrida"
 * sino **cómo se mueve la cobertura con la temporada**, y esa no se contesta con
 * una corrida: se contesta con la serie. El perfil de cobertura de una temporada
 * madura es el inverso del de una recién empezada, y
 * entre las dos fotos no hay una transición suave sino un corte.
 *
 * No falla nunca, al contrario que `check-freshness`: aquí no hay un umbral que
 * incumplir. Que la cobertura baje al empezar una temporada no es una avería, es
 * el mundo; lo que sería una avería es no verlo. El mínimo de pares servibles
 * con el que se puede lanzar es una decisión de producto que nadie ha tomado
 * todavía, y fabricarla aquí como `exit 1` sería tomarla de tapadillo.
 */

/** Cuántas corridas de la serie se imprimen si no se pide otra cosa. */
const DEFAULT_RUNS = 7;

export interface Options {
  /** Corridas de la serie histórica. La primera es siempre la vigente. */
  runs: number;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { runs: DEFAULT_RUNS };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag !== "--runs") {
      throw new Error(`Opción desconocida: ${flag}. Disponibles: --runs.`);
    }

    const value = args[++i];
    const parsed = Number(value);
    if (!value || !Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`--runs="${value ?? ""}" debe ser un entero mayor que cero.`);
    }
    options.runs = parsed;
  }

  return options;
}

/**
 * La cobertura de una corrida, leída por escalón del sujeto.
 *
 * Las dos cuentas de la derecha son la misma pregunta contada de dos formas, y
 * ninguna sustituye a la otra: "la mitad de las specs" puede ser el 5 % de los
 * jugadores si las servibles son las que nadie juega.
 */
export function printCoverage(pairs: readonly CoveragePair[]): void {
  const rollups = rollUpCoverage(pairs, DEFAULT_SEGMENT_SCALE);
  if (rollups.length === 0) {
    console.log("\nSin pares de cobertura: ningún escalón tiene sujetos con otro por encima.");
    return;
  }

  console.log("\n=== COBERTURA SERVIBLE POR PAR (spec, segmento objetivo) ===");
  console.log("(servible = el objetivo pasa canShowComparison() por gear_sample, ADR 0010)\n");

  for (const rollup of rollups) {
    // El ICP se marca porque es donde la cobertura decide si hay producto: un
    // escalón servible fuera de 1400-2200 no le sirve a nadie a quien sirvamos.
    const scope = rollup.servesIcp ? "ICP" : "   ";
    const share =
      rollup.subjects === 0
        ? "0 %"
        : `${Math.round((rollup.subjectsServed / rollup.subjects) * 100)} %`;

    console.log(
      `  ${scope} ${formatSegment(rollup.subject)} → ${formatSegment(rollup.target)}: ` +
        `${rollup.serviceablePairs}/${rollup.pairs} specs servibles ` +
        `(${rollup.populatedTargets} con objetivo poblado) · ` +
        `${rollup.subjectsServed}/${rollup.subjects} sujetos (${share})`,
    );
  }

  const icp = rollups.filter((rollup) => rollup.servesIcp);
  const serviceable = icp.reduce((total, rollup) => total + rollup.serviceablePairs, 0);
  const subjects = icp.reduce((total, rollup) => total + rollup.subjects, 0);
  const served = icp.reduce((total, rollup) => total + rollup.subjectsServed, 0);

  console.log(
    `\nEn el ICP: ${serviceable} pares servibles · ${served} de ${subjects} sujetos con Player Gap.`,
  );
}

// --- Lectura ---

interface CoverageRow {
  computed_at: Date;
  season_id: number;
  bracket: string;
  class_slug: string;
  spec_slug: string;
  subject_segment_id: string;
  subject_segment_min: number;
  subjects: number;
  segment_id: string;
  segment_min: number;
  segment_max: number | null;
  sample_size: number;
  gear_sample: number;
  activity_window_days: ActivityWindowDays | null;
}

/**
 * Reconstruye el par tal y como se guardó.
 *
 * Los dos tramos salen de las columnas y no de `segmentFor`: la escala es un
 * parámetro que puede cambiar entre temporadas, y una fila vieja tiene que
 * seguir diciendo qué dos escalones se emparejaron el día que se calculó. El
 * techo del sujeto es el suelo del objetivo porque son adyacentes por
 * construcción, así que tampoco hace falta guardarlo.
 */
function toPair(row: CoverageRow): CoveragePair {
  const target: RatingSegment = {
    min: row.segment_min,
    max: row.segment_max ?? Infinity,
    id: row.segment_id,
  };

  return {
    bracket: row.bracket,
    classSlug: row.class_slug,
    specSlug: row.spec_slug,
    subject: { min: row.subject_segment_min, max: target.min, id: row.subject_segment_id },
    subjects: row.subjects,
    target,
    targetSampleSize: row.sample_size,
    targetGearSample: row.gear_sample,
    targetWindow: row.activity_window_days,
  };
}

/**
 * Las últimas `runs` corridas, **sin filtrar por temporada**.
 *
 * Filtrar por la vigente sería tapar justo lo que se viene a ver: el corte de
 * temporada es el momento en que la cobertura se desploma, y mirarlo solo desde
 * la temporada nueva enseña una serie corta y plana que empieza en el suelo sin
 * decir desde dónde cayó.
 */
async function loadRuns(pool: pg.Pool, region: string, runs: number): Promise<CoverageRow[]> {
  const { rows } = await pool.query<CoverageRow>(
    `with runs as (
       select distinct computed_at
         from segment_coverage
        where region = $1
        order by computed_at desc
        limit $2
     )
     select c.computed_at, c.season_id, c.bracket, c.class_slug, c.spec_slug,
            c.subject_segment_id, c.subject_segment_min, c.subjects,
            c.segment_id, c.segment_min, c.segment_max,
            c.sample_size, c.gear_sample, c.activity_window_days
       from segment_coverage c
       join runs r on r.computed_at = c.computed_at
      where c.region = $1
      order by c.computed_at desc, c.bracket, c.subject_segment_min`,
    [region, runs],
  );

  return rows;
}

/** Agrupa las filas por corrida conservando el orden de la consulta. */
function byRun(
  rows: readonly CoverageRow[],
): Map<string, { row: CoverageRow; rows: CoverageRow[] }> {
  const runs = new Map<string, { row: CoverageRow; rows: CoverageRow[] }>();
  for (const row of rows) {
    const key = row.computed_at.toISOString();
    const run = runs.get(key);
    if (run) run.rows.push(row);
    else runs.set(key, { row, rows: [row] });
  }
  return runs;
}

/**
 * La serie: una línea por corrida con lo que se podía servir ese día.
 *
 * Se cuenta solo el ICP porque es la cifra que decide si hay producto, y se
 * imprime la temporada de cada corrida: el escalón entre dos líneas con
 * temporadas distintas es el reinicio de la ladder, que es lo que esta serie
 * existe para hacer visible.
 */
function printSeries(runs: ReturnType<typeof byRun>): void {
  console.log("\n=== SERIE (pares servibles del ICP por corrida) ===\n");

  let previousSeason: number | null = null;
  // De la más antigua a la más reciente: una serie se lee hacia adelante.
  for (const { row, rows } of [...runs.values()].reverse()) {
    const icp = rollUpCoverage(rows.map(toPair), DEFAULT_SEGMENT_SCALE).filter(
      (rollup) => rollup.servesIcp,
    );
    const serviceable = icp.reduce((total, rollup) => total + rollup.serviceablePairs, 0);
    const populated = icp.reduce((total, rollup) => total + rollup.populatedTargets, 0);
    const subjects = icp.reduce((total, rollup) => total + rollup.subjects, 0);
    const served = icp.reduce((total, rollup) => total + rollup.subjectsServed, 0);

    if (previousSeason !== null && previousSeason !== row.season_id) {
      console.log(`  ── corte de temporada: ${previousSeason} → ${row.season_id} ──`);
    }
    previousSeason = row.season_id;

    console.log(
      `  ${row.computed_at.toISOString()} · t${row.season_id} · ` +
        `${serviceable} servibles de ${populated} con objetivo poblado · ` +
        `${served}/${subjects} sujetos`,
    );
  }
}

export async function coverage(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();
  const pool = createPool();

  try {
    const rows = await loadRuns(pool, region, options.runs);
    if (rows.length === 0) {
      throw new Error(
        `No consta ninguna corrida de cobertura para la región ${region.toUpperCase()}. ` +
          `La escribe el agregado: npm run pipeline -- refresh-aggregates`,
      );
    }

    const runs = byRun(rows);
    const latest = [...runs.values()][0];
    if (!latest) return;

    console.log(
      `Cobertura servible · región ${region.toUpperCase()} · temporada ${latest.row.season_id}`,
    );
    console.log(`Corrida vigente: ${latest.row.computed_at.toISOString()}`);

    printCoverage(latest.rows.map(toPair));
    if (runs.size > 1) printSeries(runs);
  } finally {
    await pool.end();
  }
}
