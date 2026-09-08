import { AGGREGATE_STALE_AFTER_HOURS, aggregateAgeHours, isAggregateStale } from "@wowpvp/core";
import { getRegion } from "../config";
import { createPool } from "../db/pool";

/**
 * El vigilante de la frescura de los agregados (ADR 0031).
 *
 * Antes de esto, un `refresh-aggregates` caído se manifestaba de una sola
 * manera: la web servía el agregado de ayer **en silencio**. La fecha estaba
 * guardada —`computed_at` en cada fila— y nadie la comparaba con el reloj, así
 * que el modo de fallo más probable del producto era también el único invisible.
 *
 * **Vigila el efecto, no el job**, y por eso vive en un workflow propio en vez
 * de ser el último paso de `aggregates.yml`. Un paso allí solo se ejecuta si esa
 * corrida llega a arrancar, y "no arrancó" es justo uno de los casos que hay que
 * detectar: GitHub deshabilita los workflows programados de un repositorio
 * inactivo sin avisar a nadie.
 *
 * El aviso es el propio fallo del workflow: sale con código distinto de cero y
 * GitHub manda el correo. Sin servicio de terceros, coherente con el ADR 0028.
 *
 * Lo que **no** vigila es la cobertura servible por par `(spec, segmento)`, que
 * se mueve con la temporada y es otra pregunta: esa es de #74.
 */

interface FreshnessRow {
  region: string;
  season_id: number;
  computed_at: Date;
  segments: string;
}

export async function checkFreshness(args: string[]): Promise<void> {
  const all = args.includes("--all-regions");
  const region = getRegion();
  const pool = createPool();

  try {
    // La corrida más reciente **de cada región**, no la más reciente de la
    // tabla: con una región al día y otra parada, mirar el máximo global las
    // daría a las dos por sanas. Se agrupa por corrida —cada `computed_at` es
    // una— y se toma la última de cada región con su número de segmentos.
    const { rows } = await pool.query<FreshnessRow>(
      `select region, season_id, computed_at, segments
         from (
           select region, season_id, computed_at, count(*) as segments,
                  row_number() over (partition by region order by computed_at desc) as rn
             from population_segments
            where season_id = (select max(season_id) from population_segments)
              and ($1::boolean or region = $2)
            group by region, season_id, computed_at
         ) runs
        where rn = 1
        order by region`,
      [all, region],
    );

    if (rows.length === 0) {
      // Ni una corrida es un estado distinto de una corrida vieja, y se dice
      // distinto: en una base recién migrada es lo normal y no hay nada roto.
      console.error(
        `\n❌ No consta ninguna corrida de agregados${all ? "" : ` para la región ${region}`}. ` +
          `Si la base es nueva, lánzala con: npm run pipeline -- refresh-aggregates`,
      );
      process.exit(1);
    }

    const now = new Date();
    const stale: FreshnessRow[] = [];

    console.log(`Frescura de agregados · ${now.toISOString()}`);
    console.log(`Umbral: ${AGGREGATE_STALE_AFTER_HOURS} h desde la última corrida\n`);

    for (const row of rows) {
      const hours = aggregateAgeHours(row.computed_at, now);
      const old = isAggregateStale(row.computed_at, now);
      if (old) stale.push(row);
      console.log(
        `${old ? "⚠️ " : "✅"} ${row.region} · temporada ${row.season_id} · ` +
          `${row.segments} segmentos · ${row.computed_at.toISOString()} · hace ${hours.toFixed(1)} h`,
      );
    }

    if (stale.length > 0) {
      console.error(
        `\n❌ ${stale.length} región(es) sirviendo agregados de hace más de ` +
          `${AGGREGATE_STALE_AFTER_HOURS} h. La web los está enseñando con su fecha, ` +
          `pero la corrida que tenía que sustituirlos no ha llegado: revisa el ` +
          `workflow "Aggregates".`,
      );
      process.exit(1);
    }

    console.log("\nLa corrida vigente es la que debe ser.");
  } finally {
    await pool.end();
  }
}
