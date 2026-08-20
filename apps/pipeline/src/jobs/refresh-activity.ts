import type pg from "pg";
import { deriveActivity, type ActivityObservation, type CharacterActivity } from "@wowpvp/core";
import { getRegion } from "../config";
import { createPool } from "../db/pool";

/**
 * Materialización de `last_active_snapshot_date` (§27 del plan, #16).
 *
 * §27 exige que todo cálculo de `AggregateSnapshot` filtre por la fecha en que
 * el personaje estuvo activo de verdad, y la API no la da (§30): hay que
 * derivarla de la variación de `season_match_statistics.played` entre snapshots
 * nuestros. La regla es de dominio y vive en `@wowpvp/core`; este job solo lee
 * la serie de observaciones, la pasa por ahí y escribe el resultado.
 *
 * Se materializa en vez de calcularse al vuelo por dos razones que no son de
 * rendimiento:
 *
 * - **La serie completa no cabe en la ventana.** Para saber si alguien subió el
 *   contador dentro de los últimos 7 días hace falta la observación anterior,
 *   que puede caer fuera; y la fecha de arranque (`first-seen`) es, por
 *   definición, la más antigua de todas. Un filtro que solo mirara la ventana
 *   se contestaría a sí mismo.
 * - **Los consumidores son varios.** Los agregados (#15), el perfil (#17) y el
 *   ranking de temporada (#23) necesitan la misma fecha; recalcularla en cada
 *   uno es la forma segura de que acaben discrepando.
 *
 * La tabla es derivada: se reconstruye entera desde `character_snapshots`, así
 * que aquí sí se hace `update` sin romper el ADR 0002, que protege las
 * observaciones y no los cálculos sobre ellas.
 *
 * Se leen **todas** las fuentes, incluida `search`: la actividad es una
 * propiedad del personaje, y quién entra en un agregado es una decisión
 * posterior y distinta (ADR 0007 excluye ahí a los que solo vienen de búsqueda).
 * Eso sí, el contador de cada fuente solo se compara consigo mismo: el del
 * perfil y el del leaderboard no cuentan lo mismo (ver `counterSource` en core),
 * y `search` trae el del perfil porque sale del mismo endpoint.
 *
 * Desde #53 los snapshots de leaderboard solo guardan cambios, así que
 * `observations` cuenta observaciones **con información nueva**, no veces que le
 * hemos visto. Las veces que le hemos visto están en `character_presence`, y de
 * ahí sale `last_seen_at` (ver `withPresence`).
 */

const MS_PER_DAY = 86_400_000;

/** Filas por INSERT. Con ~5.000 personajes por bracket, un unnest gigante no aporta nada. */
const WRITE_BATCH = 1_000;

// --- Argumentos ---

export interface Options {
  /** Temporada a recalcular. null = la más alta observada. */
  seasonId: number | null;
  /** Calcula e imprime, pero no escribe. */
  dryRun: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { seasonId: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag !== "--season") {
      throw new Error(`Opción desconocida: ${flag}. Disponibles: --season, --dry-run.`);
    }

    const value = args[++i];
    const parsed = Number(value);
    if (!value || !Number.isInteger(parsed) || parsed <= 0) {
      throw new Error(`--season="${value ?? ""}" debe ser un id de temporada entero.`);
    }
    options.seasonId = parsed;
  }

  return options;
}

// --- Cálculo ---

/** Una observación del contador de partidas, tal y como sale de la tabla. */
export interface ObservationRow {
  characterId: string;
  capturedAt: Date;
  matchesPlayed: number | null;
  /** `source` del snapshot: de dónde salía el contador (ver core, counterSource). */
  source: string;
}

/** La actividad de un personaje en un bracket, lista para escribirse. */
export interface ComputedActivity extends CharacterActivity {
  characterId: string;
  bracket: string;
}

/** Cuándo le vimos por última vez en la lista del leaderboard. */
export interface PresenceRow {
  characterId: string;
  lastSeenAt: Date;
}

/**
 * Pone el "le hemos visto" de `character_presence` sobre la actividad derivada.
 *
 * Desde #53 los snapshots solo guardan cambios, así que la última observación de
 * la serie ya no dice cuándo le vimos por última vez, sino cuándo cambió por
 * última vez — que es exactamente `lastActiveAt` y convertiría el proxy en una
 * tautología. La presencia sí lo sabe.
 *
 * Se toma el más reciente de los dos, no el de presencia a secas: la actividad
 * puede venir de un snapshot de perfil o de búsqueda, fuentes que no dejan
 * presencia de leaderboard porque no son la lista.
 *
 * Sin fila de presencia se deja lo derivado: es un personaje que solo conocemos
 * por perfil o búsqueda, y ahí la serie sigue siendo toda la observación que hay.
 *
 * `firstSeenAt` no se toca: es lo que fecha la evidencia `first-seen`, y moverlo
 * por un lado sin mover `lastActiveAt` por el otro dejaría la fila diciendo dos
 * cosas distintas sobre el mismo instante.
 */
export function withPresence(
  activities: readonly ComputedActivity[],
  presence: ReadonlyMap<string, PresenceRow>,
): ComputedActivity[] {
  return activities.map((activity) => {
    const seen = presence.get(activity.characterId);
    if (!seen) return activity;
    return {
      ...activity,
      lastSeenAt: new Date(Math.max(activity.lastSeenAt.getTime(), seen.lastSeenAt.getTime())),
    };
  });
}

/**
 * Agrupa las observaciones por personaje y deriva la actividad de cada uno.
 *
 * El agrupado es por personaje **dentro de un bracket**: un multiclasser juega
 * varias specs y su contador de partidas es independiente en cada una, así que
 * mezclarlas daría subidas donde no las hubo (§27: el spec activo cambia entre
 * snapshots).
 */
export function computeActivity(
  bracket: string,
  rows: readonly ObservationRow[],
): ComputedActivity[] {
  const byCharacter = new Map<string, ActivityObservation[]>();
  for (const row of rows) {
    const observation: ActivityObservation = {
      capturedAt: row.capturedAt,
      matchesPlayed: row.matchesPlayed,
      // 'search' y 'profile' salen del mismo endpoint, así que su contador es
      // el mismo y comparte listón; el del leaderboard va aparte.
      counterSource: row.source === "search" ? "profile" : row.source,
    };
    const series = byCharacter.get(row.characterId);
    if (series) series.push(observation);
    else byCharacter.set(row.characterId, [observation]);
  }

  const computed: ComputedActivity[] = [];
  for (const [characterId, series] of byCharacter) {
    const activity = deriveActivity(series);
    if (activity) computed.push({ characterId, bracket, ...activity });
  }
  return computed;
}

export interface ActivitySummary {
  total: number;
  byDelta: number;
  byFirstSeen: number;
  /**
   * Días que el proxy anterior a #16 le regalaba de más al personaje mediano:
   * la distancia entre "le hemos visto" y "ha jugado". Es la medida del sesgo
   * que este job quita, y por eso se imprime en vez de darse por supuesta.
   */
  medianProxyGapDays: number | null;
}

export function summarizeActivity(activities: readonly ComputedActivity[]): ActivitySummary {
  const gaps = activities
    .map((a) => (a.lastSeenAt.getTime() - a.lastActiveAt.getTime()) / MS_PER_DAY)
    .sort((a, b) => a - b);

  const middle = gaps[Math.floor(gaps.length / 2)];

  return {
    total: activities.length,
    byDelta: activities.filter((a) => a.evidence === "played-delta").length,
    byFirstSeen: activities.filter((a) => a.evidence === "first-seen").length,
    medianProxyGapDays: middle === undefined ? null : Math.round(middle * 10) / 10,
  };
}

// --- Postgres ---

/** Temporada vigente: la más alta observada en la región. */
async function resolveSeason(pool: pg.Pool, region: string): Promise<number> {
  const { rows } = await pool.query<{ season_id: number | null }>(
    `select max(s.season_id) as season_id
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1`,
    [region],
  );

  const seasonId = rows[0]?.season_id;
  if (seasonId === null || seasonId === undefined) {
    throw new Error(
      `No hay snapshots de ${region.toUpperCase()}. ` +
        `Ejecuta antes: npm run pipeline -- refresh-leaderboard`,
    );
  }
  return seasonId;
}

async function loadBrackets(pool: pg.Pool, region: string, seasonId: number): Promise<string[]> {
  const { rows } = await pool.query<{ bracket: string }>(
    `select distinct s.bracket
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and s.season_id = $2
      order by s.bracket`,
    [region, seasonId],
  );
  return rows.map((row) => row.bracket);
}

/**
 * La serie entera de un bracket, sin recortar por ventana.
 *
 * Se consulta bracket a bracket y no todo de golpe para que la memoria del
 * proceso dependa del bracket más poblado (~5.000 personajes por sus
 * observaciones) y no del histórico completo, que solo crece.
 */
async function loadObservations(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  bracket: string,
): Promise<ObservationRow[]> {
  const { rows } = await pool.query<{
    character_id: string;
    captured_at: Date;
    matches_played: number | null;
    source: string;
  }>(
    `select s.character_id, s.captured_at, s.matches_played, s.source
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and s.season_id = $2 and s.bracket = $3`,
    [region, seasonId, bracket],
  );

  return rows.map((row) => ({
    characterId: row.character_id,
    capturedAt: row.captured_at,
    matchesPlayed: row.matches_played,
    source: row.source,
  }));
}

/** Presencia en la lista de un bracket, indexada por personaje. */
async function loadPresence(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  bracket: string,
): Promise<Map<string, PresenceRow>> {
  const { rows } = await pool.query<{ character_id: string; last_seen_at: Date }>(
    `select p.character_id, p.last_seen_at
       from character_presence p
       join characters c on c.id = p.character_id
      where c.region = $1 and p.season_id = $2 and p.bracket = $3`,
    [region, seasonId, bracket],
  );

  return new Map(
    rows.map((row) => [
      row.character_id,
      { characterId: row.character_id, lastSeenAt: row.last_seen_at },
    ]),
  );
}

/**
 * Escribe la actividad de un bracket.
 *
 * `on conflict do update` y no una fila nueva por corrida: a diferencia de los
 * agregados, aquí no hay histórico que conservar. La actividad de ayer no es
 * una medida distinta de la de hoy, es la misma medida con menos datos — y la
 * serie temporal que sí importa (cuándo jugó cada uno) ya está en los propios
 * snapshots, que siguen siendo append-only.
 */
async function writeActivity(
  client: pg.PoolClient,
  seasonId: number,
  computedAt: Date,
  activities: readonly ComputedActivity[],
): Promise<void> {
  for (let i = 0; i < activities.length; i += WRITE_BATCH) {
    const batch = activities.slice(i, i + WRITE_BATCH);
    await client.query(
      `insert into character_activity
         (character_id, bracket, season_id, last_active_at, evidence, last_played,
          observations, first_seen_at, last_seen_at, computed_at)
       select * from unnest(
         $1::uuid[], $2::text[], $3::int[], $4::timestamptz[], $5::text[], $6::int[],
         $7::int[], $8::timestamptz[], $9::timestamptz[], $10::timestamptz[]
       )
       on conflict (character_id, bracket, season_id) do update set
         last_active_at = excluded.last_active_at,
         evidence       = excluded.evidence,
         last_played    = excluded.last_played,
         observations   = excluded.observations,
         first_seen_at  = excluded.first_seen_at,
         last_seen_at   = excluded.last_seen_at,
         computed_at    = excluded.computed_at`,
      [
        batch.map((a) => a.characterId),
        batch.map((a) => a.bracket),
        batch.map(() => seasonId),
        batch.map((a) => a.lastActiveAt),
        batch.map((a) => a.evidence),
        batch.map((a) => a.lastPlayed),
        batch.map((a) => a.observations),
        batch.map((a) => a.firstSeenAt),
        batch.map((a) => a.lastSeenAt),
        batch.map(() => computedAt),
      ],
    );
  }
}

/**
 * Recalcula la actividad de una temporada entera y devuelve su resumen.
 *
 * Exportada aparte del comando porque `refresh-aggregates` la llama antes de
 * agregar: un adoption_rate filtrado con la actividad de ayer diría estar
 * filtrado por actividad sin estarlo, que es justo la diferencia que #16 viene
 * a quitar.
 */
export async function rebuildActivity(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  computedAt: Date,
  options: { dryRun?: boolean } = {},
): Promise<ActivitySummary> {
  const brackets = await loadBrackets(pool, region, seasonId);
  const all: ComputedActivity[] = [];
  const write = options.dryRun !== true;

  const client = await pool.connect();
  try {
    if (write) await client.query("begin");

    for (const bracket of brackets) {
      const observations = await loadObservations(pool, region, seasonId, bracket);
      const presence = await loadPresence(pool, region, seasonId, bracket);
      const activities = withPresence(computeActivity(bracket, observations), presence);
      if (write) await writeActivity(client, seasonId, computedAt, activities);
      all.push(...activities);
    }

    if (write) await client.query("commit");
  } catch (err) {
    if (write) await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return summarizeActivity(all);
}

// --- Salida ---

export function printActivitySummary(summary: ActivitySummary): void {
  const pct = (n: number): string => `${Math.round((n / summary.total) * 100)}%`;

  console.log(`${summary.total} pares (personaje, bracket) con actividad calculada:`);
  console.log(
    `  ${summary.byDelta} (${pct(summary.byDelta)}) por subida real del contador de partidas`,
  );
  console.log(
    `  ${summary.byFirstSeen} (${pct(summary.byFirstSeen)}) por primera observación, sin subida vista`,
  );

  if (summary.medianProxyGapDays !== null) {
    console.log(
      `Distancia mediana entre "le hemos visto" y "ha jugado": ${summary.medianProxyGapDays} días ` +
        `(eso es lo que el proxy anterior a #16 daba por actividad sin serlo).`,
    );
  }

  // Con pocos días de histórico el arranque domina, y conviene decirlo: la
  // ventana filtra igual —la fecha de arranque caduca sola—, pero llamar a esa
  // población "los que han jugado esta semana" sería falso hasta que la serie
  // tenga profundidad.
  if (summary.byDelta === 0 && summary.total > 0) {
    console.log(
      `\n⚠️  Ninguna subida del contador observada en toda la temporada: o el ladder está ` +
        `congelado (fin de temporada) o el histórico todavía no tiene dos publicaciones con ` +
        `juego real entre medias. Toda la población entra por primera observación.`,
    );
  }
}

// --- Job ---

export async function refreshActivity(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();

  console.log("Recálculo de la ventana de actividad (§27 del plan, #16)\n");

  const pool = createPool();
  try {
    const seasonId = options.seasonId ?? (await resolveSeason(pool, region));
    console.log(`Región ${region.toUpperCase()} · temporada ${seasonId}\n`);

    const computedAt = new Date();
    const summary = await rebuildActivity(pool, region, seasonId, computedAt, {
      dryRun: options.dryRun,
    });

    if (summary.total === 0) {
      throw new Error(
        `No hay snapshots de la temporada ${seasonId} en ${region.toUpperCase()}. ` +
          `¿Es la temporada correcta? (--season)`,
      );
    }

    printActivitySummary(summary);

    if (options.dryRun) {
      console.log(`\n--dry-run: no se ha escrito nada.`);
      return;
    }
    console.log(`\nEscrito en character_activity con computed_at ${computedAt.toISOString()}.`);
  } finally {
    await pool.end();
  }
}
