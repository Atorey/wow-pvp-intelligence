import type pg from "pg";
import { createPool } from "../db/pool";

/**
 * Retención de `aggregate_snapshots` (migración 0019).
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
 * 2. **De las anteriores sobrevive una por semana**, y de ella solo las filas
 *    con al menos `minUsers` usuarios. Es lo que puede volver a aparecer en una
 *    pantalla: una adopción de una o dos personas no llega arriba de ningún
 *    ranking y `canShowComparison()` no la dejaría publicarse aunque llegara.
 * 3. **`population_segments` no se poda nunca.** Son 4 MB para el histórico
 *    entero y es donde vive la distribución por escalón —mediana, cuartiles,
 *    denominadores—, que es la serie que sostiene la tendencia. Lo caro era el
 *    detalle por variable, no el escalón.
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

export interface Options {
  /** Usuarios mínimos para conservar una fila de una corrida no vigente. */
  minUsers: number;
  /** Cuenta y explica lo que borraría, sin borrar nada. */
  dryRun: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { minUsers: DEFAULT_MIN_USERS, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];

    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    if (flag === "--min-users") {
      const raw = args[++i];
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 1) {
        throw new Error(`--min-users pide un entero ≥ 1, no ${raw}.`);
      }
      options.minUsers = value;
      continue;
    }

    throw new Error(`Opción desconocida: ${flag}. Disponibles: --min-users, --dry-run.`);
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
}

/**
 * Las corridas que sobreviven: la última, y la última de cada semana ISO.
 *
 * Se resuelve en SQL y no en memoria porque la lista de corridas es la clave de
 * todo lo demás y tenerla en una sola expresión evita que el borrado y el
 * recuento puedan discrepar.
 */
const KEPT_RUNS = `
  select computed_at, computed_at = max(computed_at) over () as es_vigente
    from (
      select distinct on (date_trunc('week', computed_at)) computed_at
        from population_segments
       order by date_trunc('week', computed_at), computed_at desc
    ) semanal
  union
  select max(computed_at), true from population_segments
`;

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
      `with conservadas as (${KEPT_RUNS})
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
      `with conservadas as (${KEPT_RUNS})
       select (select count(distinct computed_at) from conservadas) as kept,
              (select count(distinct computed_at) from population_segments) as total`,
    );

    const before = Number(counts[0]?.before ?? 0);
    const deleted = Number(counts[0]?.deleted ?? 0);
    const kept = Number(runs[0]?.kept ?? 0);
    const total = Number(runs[0]?.total ?? 0);

    if (!options.dryRun && deleted > 0) {
      // El borrado repite la condición del recuento en vez de guardar ids: la
      // lista son cientos de miles de filas y materializarla para volver a
      // mandarla costaría más que la propia poda.
      await client.query("begin");
      await client.query(
        `with conservadas as (${KEPT_RUNS})
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
      await client.query("commit");
    }

    return { before, deleted, runsCollapsed: total - kept, runsKept: kept };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
      `con users ≥ ${options.minUsers}), ${runsCollapsed} sin detalle por variable.`,
  );
  console.log("population_segments no se toca: la distribución por escalón se conserva entera.");

  if (options.dryRun) console.log("\n--dry-run: no se ha borrado nada.");
}
