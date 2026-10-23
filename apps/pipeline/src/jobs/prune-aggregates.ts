import type pg from "pg";
import { createPool } from "../db/pool";

/**
 * Retención de `aggregate_snapshots` (migración 0019) y de las tablas que
 * escribe cada corrida y solo se leen por su última fila (ADR 0052).
 *
 * Es la tabla que más crecía del proyecto: ~75.000 filas por corrida diaria, sin
 * podar, unos 19 MB al día. La mitad del crecimiento de la base entera, en una
 * tabla que la migración 0005 declara derivada en su propia cabecera — se
 * reconstruye desde `character_snapshots`, que es la que no se toca (ADR 0002).
 *
 * La política sale de cómo se lee la tabla, no de un número redondo. Las dos
 * únicas consultas del producto contra ella, las de `packages/data/segments.ts`,
 * son de la forma:
 *
 *     where population_segment_id = $1 and variable_kind = $2
 *     order by adoption_rate desc [limit N]
 *
 * O sea: **el top de un escalón concreto de una corrida concreta**, casi siempre
 * la vigente. Nunca un recorrido del histórico, nunca la cola de la lista. De
 * ahí las tres reglas:
 *
 * 1. **La corrida más reciente se guarda entera.** Es la que sirve la web y la
 *    que decide `check-freshness`. Podarla sería podar el producto.
 * 2. **De las anteriores sobrevive una por semana, durante `weeks` semanas**,
 *    y de ella solo las filas con al menos `minUsers` usuarios. Es lo que puede
 *    volver a aparecer en una pantalla: una adopción de una o dos personas no
 *    llega arriba de ningún ranking y `canShowComparison()` no la dejaría
 *    publicarse aunque llegara. Y la única pantalla que mira atrás compara con
 *    la corrida anterior que conserve detalle (ADR 0037), así que lo que pasa
 *    de unas semanas no lo lee nadie y solo ocupa cuota (ADR 0047).
 * 3. **De `population_segments` sale lo que ya no tiene detalle ni es lo último
 *    de su escalón.** Se conservaba entera por si la distribución por escalón
 *    sostenía algún día una tendencia, pero ninguna pantalla la lee hacia atrás:
 *    se lee la corrida más reciente de cada spec y la anterior que todavía
 *    conserva agregados (ADR 0037). Los «4 MB para el histórico entero» eran
 *    13,7 el 23 de octubre de 2026, con la base en 457 de 500 (ADR 0052).
 *    Fuera de las `weeks` semanas solo sobrevive la fila más reciente de cada
 *    escalón, que es la que lee una spec que ha dejado de salir en las corridas.
 *
 * Y dos bitácoras que solo se leen por su última fila, con `logDays` días:
 *
 * - **`leaderboard_fetches`**: la ingesta compara con el último hash de cada
 *   bracket y los agregados leen la última descarga buena. Fuera de la ventana
 *   se conservan esas dos filas por bracket y temporada; el resto solo lo
 *   miraba el informe de cadencia.
 * - **`segment_coverage`**: `coverage` enseña las últimas corridas, no la serie
 *   entera.
 *
 * Lo que esto **no** es: un borrado de histórico de población. Nada de lo que
 * quita cambia una sola observación de un personaje.
 */

/**
 * Usuarios mínimos para que una fila sobreviva a su corrida.
 *
 * Cinco y no uno porque por debajo de eso la fila no describe un patrón sino un
 * puñado de personas, y no hay ninguna pantalla que la pueda enseñar: el corte
 * de confianza del ADR 0003 está mucho más arriba. No es el umbral de lo que se
 * publica —eso sigue siendo `canShowComparison()` sobre el denominador— sino el
 * de lo que merece sobrevivir a la corrida que lo calculó.
 */
const DEFAULT_MIN_USERS = 5;

/**
 * Semanas hacia atrás en las que sobrevive una corrida semanal. Cuatro dan a la
 * comparación del ADR 0037 margen de sobra para una racha sin corridas —la de
 * finales de agosto duró quince días— sin guardar detalle que nadie lee.
 */
const DEFAULT_WEEKS = 4;

/**
 * Días de bitácora que se conservan enteros. Treinta cubren de sobra las siete
 * corridas que enseña `coverage` y una racha sin corridas como la de agosto.
 */
const DEFAULT_LOG_DAYS = 30;

export interface Options {
  /** Usuarios mínimos para conservar una fila de una corrida no vigente. */
  minUsers: number;
  /** Semanas, contadas desde la corrida vigente, en las que sobrevive una semanal. */
  weeks: number;
  /** Días, contados desde la última fila, que se conservan enteros de cada bitácora. */
  logDays: number;
  /** Cuenta y explica lo que borraría, sin borrar nada. */
  dryRun: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = {
    minUsers: DEFAULT_MIN_USERS,
    weeks: DEFAULT_WEEKS,
    logDays: DEFAULT_LOG_DAYS,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (flag === "--min-users" || flag === "--weeks" || flag === "--log-days") {
      const raw = args[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`${flag} pide un entero ≥ 1, no ${raw}.`);
      }
      if (flag === "--min-users") options.minUsers = value;
      else if (flag === "--weeks") options.weeks = value;
      else options.logDays = value;
      continue;
    }

    throw new Error(
      `Opción desconocida: ${flag}. Disponibles: --min-users, --weeks, --log-days, --dry-run.`,
    );
  }

  return options;
}

export interface PruneReport {
  /** Filas antes de podar. */
  before: number;
  /** Filas que se borran (o se borrarían, en dry-run). */
  deleted: number;
  /** Corridas cuyas filas desaparecen enteras. */
  runsCollapsed: number;
  /** Corridas que se conservan: la vigente más una por semana. */
  runsKept: number;
  /** Filas que salen (o saldrían) de la regla 3 y de cada bitácora. */
  logs: Record<RetainedTable, number>;
}

/**
 * Las corridas que sobreviven: la última, y la última de cada semana ISO de las
 * `weeks` anteriores.
 *
 * Se resuelve en SQL y no en memoria porque la lista de corridas es la clave de
 * todo lo demás y tenerla en una sola expresión evita que el borrado y el
 * recuento puedan discrepar.
 *
 * Las semanas se cuentan desde la corrida vigente y no desde `now()`: si el
 * pipeline se para, lo que queda no se va borrando solo mientras nadie calcula
 * nada nuevo. `weeks` entra como literal porque la expresión se repite en
 * consultas con parámetros distintos; por eso se valida aquí y no solo al leer
 * la opción.
 */
export function keptRunsSql(weeks: number): string {
  if (!Number.isInteger(weeks) || weeks < 1) {
    throw new Error(`weeks tiene que ser un entero ≥ 1, no ${weeks}.`);
  }
  return `
  select computed_at, computed_at = max(computed_at) over () as es_vigente
    from (
      select distinct on (date_trunc('week', computed_at)) computed_at
        from population_segments
       where computed_at >= (select max(computed_at) from population_segments)
                            - make_interval(weeks => ${weeks})
       order by date_trunc('week', computed_at), computed_at desc
    ) semanal
  union
  select max(computed_at), true from population_segments
`;
}

export type RetainedTable = "population_segments" | "leaderboard_fetches" | "segment_coverage";

const RETAINED_TABLES: readonly RetainedTable[] = [
  "population_segments",
  "leaderboard_fetches",
  "segment_coverage",
];

/**
 * Qué filas salen de cada tabla de la regla 3 y de las bitácoras, como `where`
 * sobre el alias `t`. Una sola expresión por tabla sirve al recuento y al
 * borrado, como `keptRunsSql`, para que no puedan discrepar.
 *
 * Las ventanas se cuentan desde la última fila de cada tabla y no desde
 * `now()`, por lo mismo que las semanas: si el pipeline se para, nada se borra
 * solo. Y entran como literal, así que se validan aquí.
 *
 * Lo de `population_segments` se evalúa después de podar los agregados en la
 * misma transacción: el `not exists` mira lo que acaba de quedar, y una fila
 * con detalle conservado es una corrida que alguien todavía puede comparar.
 */
export function retentionSql(weeks: number, logDays: number): Record<RetainedTable, string> {
  for (const [name, value] of [
    ["weeks", weeks],
    ["logDays", logDays],
  ] as const) {
    if (!Number.isInteger(value) || value < 1) {
      throw new Error(`${name} tiene que ser un entero ≥ 1, no ${value}.`);
    }
  }

  // La última descarga buena de cada bracket y temporada, por cada uno de los
  // dos hashes: son las filas que leen la ingesta por cambio y los agregados.
  const latestFetch = (column: "content_hash" | "population_hash"): string => `
        select distinct on (region, season_id, bracket) id
          from leaderboard_fetches
         where ${column} is not null
         order by region, season_id, bracket, fetched_at desc`;

  return {
    population_segments: `
      t.computed_at < (select max(computed_at) from population_segments)
                      - make_interval(weeks => ${weeks})
      and not exists (select 1 from aggregate_snapshots a where a.population_segment_id = t.id)
      and exists (
            select 1 from population_segments newer
             where newer.region = t.region and newer.season_id = t.season_id
               and newer.bracket = t.bracket and newer.class_slug = t.class_slug
               and newer.spec_slug = t.spec_slug and newer.segment_id = t.segment_id
               and newer.computed_at > t.computed_at)`,
    leaderboard_fetches: `
      t.fetched_at < (select max(fetched_at) from leaderboard_fetches)
                     - make_interval(days => ${logDays})
      and t.id not in (${latestFetch("content_hash")})
      and t.id not in (${latestFetch("population_hash")})`,
    segment_coverage: `
      t.computed_at < (select max(computed_at) from segment_coverage)
                      - make_interval(days => ${logDays})`,
  };
}

export async function pruneAggregates(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  const pool = createPool();

  try {
    const report = await prune(pool, options);
    printReport(report, options);
  } finally {
    await pool.end();
  }
}

/**
 * Recibe el pool en vez de crearlo para poder encadenarse al final de
 * `refresh-aggregates`: la corrida que acaba de escribir es justo la que hay que
 * dejar intacta, y hacerlo en el mismo proceso evita una segunda conexión a un
 * pooler que la web comparte (ADR 0013, decisión 10).
 */
export async function prune(pool: pg.Pool, options: Options): Promise<PruneReport> {
  const client = await pool.connect();

  try {
    const { rows: counts } = await client.query<{ before: string; deleted: string }>(
      `with conservadas as (${keptRunsSql(options.weeks)})
       select
         (select count(*) from aggregate_snapshots) as before,
         (select count(*)
            from aggregate_snapshots a
            join population_segments ps on ps.id = a.population_segment_id
           where not exists (
                   select 1 from conservadas c
                    where c.computed_at = ps.computed_at and c.es_vigente)
             and (not exists (select 1 from conservadas c where c.computed_at = ps.computed_at)
                  or a.users < $1)) as deleted`,
      [options.minUsers],
    );

    const { rows: runs } = await client.query<{ kept: string; total: string }>(
      `with conservadas as (${keptRunsSql(options.weeks)})
       select (select count(distinct computed_at) from conservadas) as kept,
              (select count(distinct computed_at) from population_segments) as total`,
    );

    const before = Number(counts[0]?.before ?? 0);
    const deleted = Number(counts[0]?.deleted ?? 0);
    const kept = Number(runs[0]?.kept ?? 0);
    const total = Number(runs[0]?.total ?? 0);
    const retention = retentionSql(options.weeks, options.logDays);
    const logs: Record<RetainedTable, number> = {
      population_segments: 0,
      leaderboard_fetches: 0,
      segment_coverage: 0,
    };

    if (options.dryRun) {
      // Se cuenta, no se borra y se deshace: un delete deshecho deja las tuplas
      // muertas en el fichero y sube la cuota que esto viene a bajar. El recuento
      // de population_segments mira los agregados de antes de la poda, así que
      // puede quedarse corto, nunca largo.
      for (const table of RETAINED_TABLES) {
        const { rows } = await client.query<{ n: string }>(
          `select count(*) as n from ${table} t where ${retention[table]}`,
        );
        logs[table] = Number(rows[0]?.n ?? 0);
      }
    } else {
      await client.query("begin");
      if (deleted > 0) await deleteAggregates(client, options);
      for (const table of RETAINED_TABLES) {
        const result = await client.query(`delete from ${table} t where ${retention[table]}`);
        logs[table] = result.rowCount ?? 0;
      }
      await client.query("commit");
    }

    return { before, deleted, runsCollapsed: total - kept, runsKept: kept, logs };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * El borrado repite la condición del recuento en vez de guardar ids: la lista
 * son cientos de miles de filas y materializarla para volver a mandarla
 * costaría más que la propia poda.
 */
async function deleteAggregates(client: pg.PoolClient, options: Options): Promise<void> {
  await client.query(
    `with conservadas as (${keptRunsSql(options.weeks)})
     delete from aggregate_snapshots a
      using population_segments ps
      where ps.id = a.population_segment_id
        and not exists (
              select 1 from conservadas c
               where c.computed_at = ps.computed_at and c.es_vigente)
        and (not exists (select 1 from conservadas c where c.computed_at = ps.computed_at)
             or a.users < $1)`,
    [options.minUsers],
  );
}

function printReport(report: PruneReport, options: Options): void {
  const { before, deleted, runsKept, runsCollapsed } = report;
  const after = before - deleted;
  const pct = before === 0 ? 0 : Math.round((deleted / before) * 1000) / 10;
  const verbo = options.dryRun ? "se borrarían" : "borradas";

  console.log(
    `aggregate_snapshots: ${before.toLocaleString("es-ES")} filas, ` +
      `${deleted.toLocaleString("es-ES")} ${verbo} (${pct}%), ` +
      `quedan ${after.toLocaleString("es-ES")}.`,
  );
  console.log(
    `Corridas: ${runsKept} conservadas (la vigente entera, el resto una por semana ` +
      `de las últimas ${options.weeks} con users ≥ ${options.minUsers}), ` +
      `${runsCollapsed} sin detalle por variable.`,
  );
  for (const table of RETAINED_TABLES) {
    console.log(`${table}: ${report.logs[table].toLocaleString("es-ES")} filas ${verbo}.`);
  }
  console.log(
    "El fichero no encoge con el borrado: la cuota lo nota tras un `compact` (ADR 0034).",
  );

  if (options.dryRun) console.log("\n--dry-run: no se ha borrado nada.");
}
