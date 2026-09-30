import type pg from "pg";
import { AGGREGATE_STALE_AFTER_HOURS, aggregateAgeHours, isAggregateStale } from "@wowpvp/core";
import { getRegion } from "../config";
import { DATA_TTL_DAYS, MS_PER_DAY, REVALIDATE_AFTER_DAYS } from "../data-ttl";
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
 * se mueve con la temporada y es otra pregunta: esa la contesta el comando
 * `coverage` (ADR 0032). Una corrida puede estar al día y no poder servirle una
 * comparación a nadie.
 *
 * Vigila también la revalidación de 30 días (ADR 0043), por el mismo motivo:
 * `/privacy` promete que ningún dato pasa de ese plazo sin comprobar que el
 * personaje existe, y un barrido que deja de correr lo incumple en silencio.
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
    // Las dos comprobaciones corren siempre: que falle una no dice nada de la
    // otra, y un fallo no debe esconder el otro.
    const aggregatesOk = await checkAggregates(pool, all, region);
    console.log("");
    const retentionOk = await checkRetention(pool, all, region);
    if (!aggregatesOk || !retentionOk) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

async function checkAggregates(pool: pg.Pool, all: boolean, region: string): Promise<boolean> {
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
    return false;
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
    return false;
  }

  console.log("\nLa corrida vigente es la que debe ser.");
  return true;
}

/**
 * Nadie pasa de `DATA_TTL_DAYS` sin prueba de existencia, y lo de quien se borró
 * sale de Storage antes de ese mismo plazo, contado desde su última prueba.
 */
async function checkRetention(pool: pg.Pool, all: boolean, region: string): Promise<boolean> {
  const now = new Date();
  const ttl = new Date(now.getTime() - DATA_TTL_DAYS * MS_PER_DAY);
  const due = new Date(now.getTime() - REVALIDATE_AFTER_DAYS * MS_PER_DAY);

  const { rows } = await pool.query<{
    overdue: string;
    due: string;
    oldest: Date | null;
    pending: string;
    stuck: string;
  }>(
    `select (select count(*) from characters
              where verified_at < $1 and ($3::boolean or region = $4)) as overdue,
            (select count(*) from characters
              where verified_at < $2 and ($3::boolean or region = $4)) as due,
            (select min(verified_at) from characters
              where $3::boolean or region = $4) as oldest,
            (select count(*) from character_erasures where purged_at is null) as pending,
            (select count(*) from character_erasures
              where purged_at is null and last_verified_at < $1) as stuck`,
    [ttl, due, all, region],
  );
  const row = rows[0];
  const overdue = Number(row?.overdue ?? 0);
  const stuck = Number(row?.stuck ?? 0);

  console.log(`Revalidación de ${DATA_TTL_DAYS} días (ADR 0043)`);
  console.log(
    `${overdue === 0 ? "✅" : "⚠️ "} ${Number(row?.due ?? 0)} personajes sin prueba de existencia ` +
      `en ${REVALIDATE_AFTER_DAYS} días, ${overdue} en ${DATA_TTL_DAYS} · la más antigua: ` +
      `${row?.oldest?.toISOString() ?? "—"}`,
  );
  console.log(
    `${stuck === 0 ? "✅" : "⚠️ "} ${Number(row?.pending ?? 0)} borrados pendientes de salir ` +
      `de Storage, ${stuck} fuera de plazo`,
  );

  if (overdue > 0) {
    console.error(
      `\n❌ ${overdue} personaje(s) llevan más de ${DATA_TTL_DAYS} días sin que se compruebe que ` +
        `existen, que es lo que la ToU de Blizzard y /privacy prometen que no pasa. Revisa el ` +
        `workflow "Revalidation", o sube REVALIDATION_BUDGET si el barrido no da abasto.`,
    );
  }
  if (stuck > 0) {
    console.error(
      `\n❌ ${stuck} personaje(s) borrados siguen en el archivo de Storage pasado el plazo. ` +
        `Revisa el paso purge-archive del workflow "Aggregates".`,
    );
  }
  return overdue === 0 && stuck === 0;
}
