import type pg from "pg";
import {
  ACTIVITY_WINDOWS,
  DEFAULT_SEGMENT_SCALE,
  aggregateSegment,
  formatSegment,
  groupBySegment,
  isActiveWithin,
  parseShuffleBracket,
  pickActivityWindow,
  segmentFor,
  summarizeSegment,
  type ActivityEvidence,
  type ActivityWindowDays,
  type AggregatedVariable,
  type PlayerBuild,
  type SegmentSummary,
} from "@wowpvp/core";
import { getRegion } from "../config";
import { createPool } from "../db/pool";
import { printActivitySummary, rebuildActivity } from "./refresh-activity";

/**
 * Recálculo periódico de PopulationSegment + AggregateSnapshot (§28 del plan, #15).
 *
 * El job no calcula nada por su cuenta: carga la población activa, la reparte
 * en segmentos y delega en @wowpvp/core, igual que hace player-gap. Aquí solo
 * hay SQL, elección de ventana y escritura.
 *
 * Corre a diario y por separado del leaderboard (ADR 0007): la agregación es
 * una decisión diaria del plan y el batch de leaderboard va cada 3h, así que
 * encadenarlos ataría una cadencia a la otra y un fallo de la descarga se
 * llevaría por delante el agregado del día.
 *
 * Dos cosas que conviene tener presentes, escritas también en las filas que
 * produce:
 *
 * - **La actividad es la de §27**, derivada de la variación real del contador
 *   de partidas (#16): quien sigue saliendo en el leaderboard sin jugar no
 *   entra. Como el histórico todavía es corto, buena parte de la población
 *   entra por primera observación en vez de por subida vista, así que cada fila
 *   guarda el reparto (`active_by_delta` / `active_by_first_seen`) y no solo el
 *   total. La actividad se recalcula al empezar la corrida: agregar con la de
 *   ayer sería decir que se filtra por actividad sin hacerlo.
 * - **El rating es de hoy y el gear puede ser de hace días.** Vienen de fuentes
 *   distintas del mismo personaje (leaderboard vs. muestreo de perfiles), así
 *   que la fila guarda el rango temporal de los perfiles usados en vez de
 *   dejarlo suponer.
 */

const MS_PER_DAY = 86_400_000;

// --- Argumentos ---

export interface Options {
  /** Ventana forzada. null = la elige pickActivityWindow por segmento (§13.4). */
  window: ActivityWindowDays | null;
  /** Calcula e imprime, pero no escribe. Para inspeccionar antes de publicar. */
  dryRun: boolean;
}

const VALID_WINDOWS: readonly number[] = Object.values(ACTIVITY_WINDOWS);

export function parseOptions(args: string[]): Options {
  const options: Options = { window: null, dryRun: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (flag !== "--window") {
      throw new Error(`Opción desconocida: ${flag}. Disponibles: --window, --dry-run.`);
    }

    const value = args[++i];
    const parsed = Number(value);
    if (!value || !VALID_WINDOWS.includes(parsed)) {
      throw new Error(
        `--window="${value ?? ""}" debe ser una de las ventanas de §27: ${VALID_WINDOWS.join(", ")}.`,
      );
    }
    options.window = parsed as ActivityWindowDays;
  }

  return options;
}

// --- Población ---

/** Última observación de rating de un personaje en un bracket, con su actividad. */
export interface ActiveRow {
  characterId: string;
  bracket: string;
  classSlug: string;
  specSlug: string;
  rating: number;
  capturedAt: Date;
  /** `last_active_snapshot_date` (§27), materializado por refresh-activity. */
  lastActiveAt: Date;
  activityEvidence: ActivityEvidence;
}

/** Último perfil completo de un personaje en un bracket: lo que aporta gear y talentos. */
export interface ProfileRow {
  characterId: string;
  bracket: string;
  capturedAt: Date;
  equippedItemLevel: number | null;
  averageItemLevel: number | null;
  talentLoadoutCode: string | null;
  gearBySlot: Map<string, number>;
}

/**
 * Un personaje activo listo para agregar: lo que core compara, más el bracket
 * y las dos marcas temporales que hacen falta para trazar el número.
 */
export interface Member extends PlayerBuild {
  bracket: string;
  classSlug: string;
  specSlug: string;
  /** Cuándo se vio por última vez su rating. No es lo que decide si está activo. */
  capturedAt: Date;
  /** Cuándo jugó por última vez, hasta donde se puede demostrar (§27, #16). */
  lastActiveAt: Date;
  /** Si esa fecha es una subida vista del contador o la primera observación. */
  activityEvidence: ActivityEvidence;
  /** Cuándo se bajó el perfil del que sale su gear. null si no hay perfil. */
  profileCapturedAt: Date | null;
}

function memberKey(characterId: string, bracket: string): string {
  return `${characterId}|${bracket}`;
}

function segmentKey(bracket: string, segmentId: string): string {
  return `${bracket}|${segmentId}`;
}

/**
 * Combina la última observación de rating con el último perfil completo del
 * mismo personaje.
 *
 * El rating sale siempre del snapshot más reciente, aunque sea de leaderboard y
 * no traiga equipo: segmentar por un perfil de hace días metería en 1800-2000 a
 * quien hoy está en 2200. El gear sale del perfil más reciente que haya en la
 * ventana, que casi nunca es el mismo snapshot — y si no hay ninguno, el
 * personaje cuenta en el tamaño del segmento pero sale de los denominadores de
 * gear y talentos (regla 5: eso es "no disponible", no "no lleva").
 */
export function buildMembers(
  active: readonly ActiveRow[],
  profiles: readonly ProfileRow[],
): Member[] {
  const byKey = new Map<string, ProfileRow>();
  for (const profile of profiles)
    byKey.set(memberKey(profile.characterId, profile.bracket), profile);

  return active.map((row) => {
    const profile = byKey.get(memberKey(row.characterId, row.bracket));
    return {
      characterId: row.characterId,
      bracket: row.bracket,
      classSlug: row.classSlug,
      specSlug: row.specSlug,
      rating: row.rating,
      capturedAt: row.capturedAt,
      lastActiveAt: row.lastActiveAt,
      activityEvidence: row.activityEvidence,
      profileCapturedAt: profile?.capturedAt ?? null,
      gearBySlot: profile?.gearBySlot ?? new Map<string, number>(),
      talentLoadoutCode: profile?.talentLoadoutCode ?? null,
      equippedItemLevel: profile?.equippedItemLevel ?? null,
      averageItemLevel: profile?.averageItemLevel ?? null,
    };
  });
}

// --- Ventana de actividad ---

/**
 * El único sitio donde se decide si un personaje está activo (§27).
 *
 * La regla en sí no está aquí sino en core (`isActiveWithin`), que es lo que
 * garantiza que la web de Phase 2 filtre igual; esta función solo dice qué
 * fecha del personaje se compara con la ventana, y desde #16 es la de haber
 * jugado, no la de haber sido visto.
 */
export function withinWindow(member: Member, now: Date, days: ActivityWindowDays): boolean {
  return isActiveWithin(member, now, days);
}

export interface WindowedPopulation {
  window: ActivityWindowDays;
  members: Member[];
}

/**
 * Población de un segmento en la ventana más fresca que alcance muestra.
 *
 * Sin ventana forzada se aplica la regla de §13.4 vía core: 7 días si llegan a
 * n=30, si no 14. La elección es por segmento, no por bracket — un mismo
 * Frost Mage puede tener 7 días de sobra en 1800-2000 y necesitar 14 en
 * 2600-2800, y forzar la misma ventana a los dos significaría o perder muestra
 * arriba o perder frescura abajo.
 */
export function selectByWindow(
  members: readonly Member[],
  now: Date,
  forced: ActivityWindowDays | null,
): WindowedPopulation {
  const inWindow = (days: ActivityWindowDays): Member[] =>
    members.filter((member) => withinWindow(member, now, days));

  if (forced !== null) return { window: forced, members: inWindow(forced) };

  const choice = pickActivityWindow({
    7: inWindow(ACTIVITY_WINDOWS.default).length,
    14: inWindow(ACTIVITY_WINDOWS.fallback).length,
  });
  return { window: choice.window, members: inWindow(choice.window) };
}

// --- Carga desde Postgres ---

/**
 * Temporada vigente: la más alta observada dentro de la ventana.
 *
 * Se agrega una sola temporada por corrida porque §27 lo prohíbe expresamente
 * ("nunca mezclando specs distintas o temporadas distintas"): en el cambio de
 * temporada conviven snapshots de las dos durante días, y sumarlos daría una
 * distribución que no describe ninguna de ellas.
 */
async function resolveSeason(
  pool: pg.Pool,
  region: string,
  cutoff: Date,
): Promise<{ seasonId: number; seasons: number[] }> {
  const { rows } = await pool.query<{ season_id: number }>(
    `select distinct s.season_id
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and s.captured_at >= $2
      order by s.season_id desc`,
    [region, cutoff],
  );

  const seasons = rows.map((row) => row.season_id);
  const seasonId = seasons[0];
  if (seasonId === undefined) {
    throw new Error(
      `No hay snapshots de ${region.toUpperCase()} en la ventana. ` +
        `Ejecuta antes: npm run pipeline -- refresh-leaderboard`,
    );
  }
  return { seasonId, seasons };
}

async function loadActive(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  cutoff: Date,
): Promise<ActiveRow[]> {
  // distinct on = la observación más reciente de cada personaje en cada bracket.
  // Un personaje puede jugar varias specs: la clave es (personaje, bracket), no
  // el personaje solo (§27: el spec activo cambia entre snapshots).
  // El join con character_activity es interno a propósito: sin fila de
  // actividad no se puede afirmar que alguien esté activo, y meterlo igual
  // "porque se le ha visto" es justo el proxy que #16 sustituye. La tabla se
  // reconstruye al empezar la corrida, así que faltar solo puede faltar si
  // alguien salta ese paso.
  const { rows } = await pool.query<{
    character_id: string;
    bracket: string;
    class_slug: string;
    spec_slug: string;
    rating: number;
    captured_at: Date;
    last_active_at: Date;
    evidence: ActivityEvidence;
  }>(
    `select distinct on (s.character_id, s.bracket)
            s.character_id, s.bracket, s.class_slug, s.spec_slug, s.rating, s.captured_at,
            a.last_active_at, a.evidence
       from character_snapshots s
       join characters c on c.id = s.character_id
       join character_activity a
         on a.character_id = s.character_id and a.bracket = s.bracket
        and a.season_id = s.season_id
      where c.region = $1 and s.season_id = $2 and s.captured_at >= $3
        and s.source <> 'search'
      order by s.character_id, s.bracket, s.captured_at desc`,
    [region, seasonId, cutoff],
  );

  return rows.map((row) => ({
    characterId: row.character_id,
    bracket: row.bracket,
    classSlug: row.class_slug,
    specSlug: row.spec_slug,
    rating: row.rating,
    capturedAt: row.captured_at,
    lastActiveAt: row.last_active_at,
    activityEvidence: row.evidence,
  }));
}

/**
 * Personajes que en esta ventana solo existen porque alguien los buscó.
 *
 * No entran en el agregado (ADR 0007), pero sí se cuentan: son la única
 * población posible por debajo del corte del leaderboard, y el día que ese
 * número sea grande la decisión de excluirlos hay que revisarla con dato
 * delante, no de memoria.
 *
 * Se les aplica la misma ventana de actividad que al resto, con el corte más
 * ancho de la corrida: si no, el contador de "cuánta población nos estamos
 * dejando" incluiría a gente que tampoco entraría estando permitida, y el dato
 * con el que se revisaría la decisión estaría inflado.
 */
async function loadSearchOnly(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  cutoff: Date,
): Promise<{ bracket: string; rating: number }[]> {
  const { rows } = await pool.query<{ bracket: string; rating: number }>(
    `with active as (
       select s.character_id, s.bracket, s.source, s.rating, s.captured_at
         from character_snapshots s
         join characters c on c.id = s.character_id
         join character_activity a
           on a.character_id = s.character_id and a.bracket = s.bracket
          and a.season_id = s.season_id
        where c.region = $1 and s.season_id = $2 and s.captured_at >= $3
          and a.last_active_at >= $3
     ),
     search_only as (
       select character_id, bracket
         from active
        group by character_id, bracket
       having bool_and(source = 'search')
     )
     select distinct on (a.character_id, a.bracket) a.bracket, a.rating
       from active a
       join search_only so on so.character_id = a.character_id and so.bracket = a.bracket
      order by a.character_id, a.bracket, a.captured_at desc`,
    [region, seasonId, cutoff],
  );
  return rows;
}

async function loadProfiles(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  cutoff: Date,
): Promise<{ profiles: ProfileRow[]; itemNames: Map<number, string> }> {
  const { rows: snapshots } = await pool.query<{
    id: string;
    character_id: string;
    bracket: string;
    captured_at: Date;
    average_item_level: number | null;
    equipped_item_level: number | null;
    talent_loadout_code: string | null;
  }>(
    `select distinct on (s.character_id, s.bracket)
            s.id, s.character_id, s.bracket, s.captured_at,
            s.average_item_level, s.equipped_item_level, s.talent_loadout_code
       from character_snapshots s
       join characters c on c.id = s.character_id
      where c.region = $1 and s.season_id = $2 and s.captured_at >= $3
        and s.source = 'profile'
      order by s.character_id, s.bracket, s.captured_at desc`,
    [region, seasonId, cutoff],
  );

  const { rows: gear } = await pool.query<{
    snapshot_id: string;
    slot: string;
    item_id: string;
    item_name: string | null;
  }>(
    `select g.snapshot_id, g.slot, g.item_id, g.item_name
       from character_snapshot_gear g
      where g.snapshot_id = any($1::bigint[])`,
    [snapshots.map((row) => row.id)],
  );

  const gearBySnapshot = new Map<string, Map<string, number>>();
  const itemNames = new Map<number, string>();
  for (const row of gear) {
    const itemId = Number(row.item_id);
    let slots = gearBySnapshot.get(row.snapshot_id);
    if (!slots) {
      slots = new Map<string, number>();
      gearBySnapshot.set(row.snapshot_id, slots);
    }
    slots.set(row.slot, itemId);
    if (row.item_name && !itemNames.has(itemId)) itemNames.set(itemId, row.item_name);
  }

  const profiles = snapshots.map((row) => ({
    characterId: row.character_id,
    bracket: row.bracket,
    capturedAt: row.captured_at,
    equippedItemLevel: row.equipped_item_level,
    averageItemLevel: row.average_item_level,
    talentLoadoutCode: row.talent_loadout_code,
    gearBySlot: gearBySnapshot.get(row.id) ?? new Map<string, number>(),
  }));

  return { profiles, itemNames };
}

// --- Cálculo ---

/** Un segmento ya calculado, listo para escribirse. */
export interface ComputedSegment {
  bracket: string;
  classSlug: string;
  specSlug: string;
  segmentId: string;
  segmentMin: number;
  /** null en el tramo abierto de arriba. */
  segmentMax: number | null;
  window: ActivityWindowDays;
  summary: SegmentSummary;
  /** De la población activa, cuántos por subida vista del contador de partidas. */
  activeByDelta: number;
  /** Y cuántos por primera observación, sin subida vista (§27, #16). */
  activeByFirstSeen: number;
  variables: AggregatedVariable[];
  profileFrom: Date | null;
  profileTo: Date | null;
  excludedSearch: number;
}

function profileRange(members: readonly Member[]): { from: Date | null; to: Date | null } {
  const stamps = members
    .map((member) => member.profileCapturedAt)
    .filter((stamp): stamp is Date => stamp !== null)
    .map((stamp) => stamp.getTime());

  if (stamps.length === 0) return { from: null, to: null };
  return { from: new Date(Math.min(...stamps)), to: new Date(Math.max(...stamps)) };
}

export function computeSegments(
  members: readonly Member[],
  searchOnly: readonly { bracket: string; rating: number }[],
  now: Date,
  forcedWindow: ActivityWindowDays | null,
): ComputedSegment[] {
  const excluded = new Map<string, number>();
  for (const row of searchOnly) {
    const key = segmentKey(row.bracket, segmentFor(row.rating, DEFAULT_SEGMENT_SCALE).id);
    excluded.set(key, (excluded.get(key) ?? 0) + 1);
  }

  const byBracket = new Map<string, Member[]>();
  for (const member of members) {
    const bucket = byBracket.get(member.bracket);
    if (bucket) bucket.push(member);
    else byBracket.set(member.bracket, [member]);
  }

  const computed: ComputedSegment[] = [];
  for (const [bracket, bracketMembers] of [...byBracket].sort(([a], [b]) => a.localeCompare(b))) {
    const bySegment = groupBySegment(bracketMembers, (rating) =>
      segmentFor(rating, DEFAULT_SEGMENT_SCALE),
    );

    for (const [segmentId, segmentMembers] of [...bySegment].sort(
      ([a], [b]) => Number(a.split("-")[0]) - Number(b.split("-")[0]),
    )) {
      // La ventana se elige con la población del segmento, y después se filtra
      // con ella: elegirla sobre el bracket entero daría 7 días en un segmento
      // que a 7 días no llega a n=30.
      const { window, members: active } = selectByWindow(segmentMembers, now, forcedWindow);
      // Un segmento que se queda sin nadie dentro de la ventana no se escribe:
      // la fila diría n=0 sin distinguir "no hay nadie ahí" de "no lo miramos".
      if (active.length === 0) continue;

      const first = active[0];
      if (!first) continue;
      const segment = segmentFor(first.rating, DEFAULT_SEGMENT_SCALE);
      const range = profileRange(active);

      computed.push({
        bracket,
        classSlug: first.classSlug,
        specSlug: first.specSlug,
        segmentId,
        segmentMin: segment.min,
        segmentMax: Number.isFinite(segment.max) ? segment.max : null,
        window,
        summary: summarizeSegment(active),
        activeByDelta: active.filter((m) => m.activityEvidence === "played-delta").length,
        activeByFirstSeen: active.filter((m) => m.activityEvidence === "first-seen").length,
        variables: aggregateSegment(active),
        profileFrom: range.from,
        profileTo: range.to,
        excludedSearch: excluded.get(segmentKey(bracket, segmentId)) ?? 0,
      });
    }
  }

  return computed;
}

// --- Escritura ---

/**
 * Todas las filas de una corrida entran o no entra ninguna.
 *
 * En una transacción porque el consumidor lee "el computed_at más reciente de
 * este segmento": una corrida a medias dejaría unos brackets con agregado nuevo
 * y otros con el de ayer bajo la misma marca temporal, y nada distinguiría una
 * cosa de la otra al leerlo.
 */
async function writeSegments(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  computedAt: Date,
  segments: readonly ComputedSegment[],
  itemNames: Map<number, string>,
): Promise<{ variables: number }> {
  const client = await pool.connect();
  let variables = 0;

  try {
    await client.query("begin");

    for (const segment of segments) {
      const { summary } = segment;
      const { rows } = await client.query<{ id: string }>(
        `insert into population_segments
           (computed_at, region, season_id, bracket, class_slug, spec_slug,
            segment_id, segment_min, segment_max, activity_window_days,
            sample_size, confidence, rating_median, rating_p25, rating_p75,
            rating_min, rating_max, equipped_item_level_median,
            item_level_sample, gear_sample, talent_sample,
            profile_data_from, profile_data_to, excluded_search,
            active_by_delta, active_by_first_seen)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26)
         returning id`,
        [
          computedAt,
          region,
          seasonId,
          segment.bracket,
          segment.classSlug,
          segment.specSlug,
          segment.segmentId,
          segment.segmentMin,
          segment.segmentMax,
          segment.window,
          summary.sampleSize,
          summary.confidence,
          summary.ratingMedian,
          summary.ratingP25,
          summary.ratingP75,
          summary.ratingMin,
          summary.ratingMax,
          summary.equippedItemLevelMedian,
          summary.itemLevelSample,
          summary.gearSample,
          summary.talentSample,
          segment.profileFrom,
          segment.profileTo,
          segment.excludedSearch,
          segment.activeByDelta,
          segment.activeByFirstSeen,
        ],
      );

      const segmentRowId = rows[0]?.id;
      if (!segmentRowId) throw new Error(`No se pudo insertar el segmento ${segment.segmentId}.`);

      for (const variable of segment.variables) {
        await client.query(
          `insert into aggregate_snapshots
             (population_segment_id, variable_kind, variable_key, slot_group, item_id,
              item_name, users, denominator, unavailable, adoption_rate)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            segmentRowId,
            variable.kind,
            variable.key,
            variable.slotGroup,
            variable.itemId,
            variable.itemId === null ? null : (itemNames.get(variable.itemId) ?? null),
            variable.adoption.users,
            variable.adoption.denominator,
            variable.adoption.unavailable,
            variable.adoption.value,
          ],
        );
        variables++;
      }
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return { variables };
}

// --- Salida ---

function printSegments(segments: readonly ComputedSegment[]): void {
  console.log("\n=== AGREGADOS POR SEGMENTO ===");
  console.log("(confianza según §13.4: high n≥100, medium n≥30, por debajo no se compara)\n");

  let currentBracket = "";
  for (const segment of segments) {
    if (segment.bracket !== currentBracket) {
      currentBracket = segment.bracket;
      console.log(`${parseShuffleBracket(segment.bracket)?.label ?? segment.bracket}:`);
    }

    const { summary } = segment;
    const label = formatSegment({
      min: segment.segmentMin,
      max: segment.segmentMax ?? Infinity,
      id: segment.segmentId,
    });
    const perfiles =
      summary.gearSample === 0
        ? "sin perfiles"
        : `${summary.gearSample} perfiles, ${segment.variables.length} variables`;

    // El reparto de la evidencia se imprime junto al n porque forma parte de
    // lo que ese n promete: 120 personas de las que hemos visto jugar a 3 no es
    // la misma muestra que 120 de las que hemos visto jugar a 118.
    const evidencia =
      segment.activeByDelta === 0
        ? "ninguno con partidas vistas"
        : `${segment.activeByDelta} con partidas vistas`;

    console.log(
      `  ${label}: n=${summary.sampleSize} (${summary.confidence}, ventana ${segment.window}d, ` +
        `${evidencia}) · mediana ${summary.ratingMedian ?? "—"} CR · ${perfiles}`,
    );
  }
  console.log("");
}

// --- Job ---

/**
 * `borrowedPool` existe para el seed y su test de integración, que ya tienen
 * abierta la base contra la que quieren agregar. Sin él, la única forma de
 * agregar sobre otra base sería reescribir el job — y entonces lo que
 * comprobaría el test no sería este job.
 */
export async function refreshAggregates(args: string[], borrowedPool?: pg.Pool): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();
  const now = new Date();
  // Se carga con la ventana más ancha que pueda usarse y se recorta después por
  // segmento: una consulta, no una por ventana.
  const widest = options.window ?? ACTIVITY_WINDOWS.fallback;
  const cutoff = new Date(now.getTime() - widest * MS_PER_DAY);

  console.log("Recálculo de agregados por segmento (§27/§28 del plan)\n");
  console.log(
    `Región ${region.toUpperCase()} · ventana ${options.window === null ? `hasta ${widest}d (elegida por segmento)` : `${widest}d (forzada)`} · ` +
      `población desde ${cutoff.toISOString()}`,
  );

  const pool = borrowedPool ?? createPool();
  try {
    const { seasonId, seasons } = await resolveSeason(pool, region, cutoff);
    if (seasons.length > 1) {
      // Convive con el cambio de temporada: se agrega solo la vigente porque
      // §27 prohíbe mezclarlas, pero se dice en voz alta que hay otra ahí.
      console.log(
        `⚠️  Hay snapshots de ${seasons.length} temporadas en la ventana (${seasons.join(", ")}). ` +
          `Se agrega solo la ${seasonId}.`,
      );
    }
    console.log(`Temporada ${seasonId}.\n`);

    // Primero la actividad y después el agregado, en la misma corrida: la
    // ventana de §27 filtra por "ha jugado", y hacerlo con una tabla calculada
    // ayer daría por activo a quien dejó de jugar justo después.
    //
    // En --dry-run se calcula pero no se escribe, así que el recorte por
    // ventana lo hará la actividad que ya estuviera materializada: la
    // inspección previa no puede dejar rastro en la base de datos.
    console.log("Ventana de actividad (§27, #16):");
    printActivitySummary(
      await rebuildActivity(pool, region, seasonId, now, { dryRun: options.dryRun }),
    );
    if (options.dryRun) {
      console.log(
        "(--dry-run: la actividad no se ha escrito; los segmentos de abajo se filtran con la " +
          "que ya hubiera en character_activity)",
      );
    }
    console.log("");

    const [active, searchOnly, { profiles, itemNames }] = await Promise.all([
      loadActive(pool, region, seasonId, cutoff),
      loadSearchOnly(pool, region, seasonId, cutoff),
      loadProfiles(pool, region, seasonId, cutoff),
    ]);

    console.log(
      `Población cargada: ${active.length} personajes activos, ${profiles.length} con perfil completo` +
        `${searchOnly.length > 0 ? `, ${searchOnly.length} excluidos por venir solo de búsqueda` : ""}.`,
    );

    const members = buildMembers(active, profiles);
    const segments = computeSegments(members, searchOnly, now, options.window);
    if (segments.length === 0) {
      throw new Error(
        `Ningún segmento tiene población dentro de la ventana de ${widest} días. ` +
          `Puede ser que no esté corriendo el job de leaderboard, o que character_activity ` +
          `esté vacía para esta temporada (con --dry-run no se escribe): ` +
          `npm run pipeline -- refresh-activity`,
      );
    }

    printSegments(segments);

    if (options.dryRun) {
      const variables = segments.reduce((acc, s) => acc + s.variables.length, 0);
      console.log(
        `--dry-run: no se ha escrito nada (serían ${segments.length} segmentos y ${variables} variables).`,
      );
      return;
    }

    const computedAt = new Date();
    const { variables } = await writeSegments(
      pool,
      region,
      seasonId,
      computedAt,
      segments,
      itemNames,
    );

    console.log(
      `${segments.length} segmentos y ${variables} variables escritos con computed_at ` +
        `${computedAt.toISOString()}.`,
    );

    // La cobertura de perfiles es la limitación que decide si estos agregados
    // sirven para algo más que la distribución: sin perfiles no hay
    // adoption_rate, y eso no debe descubrirse leyendo una tabla vacía.
    const withProfiles = segments.filter((s) => s.summary.gearSample > 0).length;
    if (withProfiles === 0) {
      console.log(
        "\n⚠️  Ningún segmento tiene perfiles en la ventana: solo se ha publicado la " +
          "distribución de población. Para que haya adoption_rate hace falta ejecutar " +
          "sample-profiles dentro de la ventana de actividad.",
      );
    } else {
      console.log(
        `Cobertura de perfiles: ${withProfiles}/${segments.length} segmentos con adoption_rate.`,
      );
    }
  } finally {
    // El pool prestado lo cierra quien lo abrió: cerrarlo aquí dejaría sin base
    // a lo que venga después en la misma corrida.
    if (!borrowedPool) await pool.end();
  }
}
