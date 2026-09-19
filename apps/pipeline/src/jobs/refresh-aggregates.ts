import type pg from "pg";
import {
  ACTIVITY_WINDOWS,
  DEFAULT_SEGMENT_SCALE,
  aggregateSegment,
  buildCoverage,
  confidenceFor,
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
  type CoveragePair,
  type GearSelection,
  type HeroTreeSelection,
  type PlayerBuild,
  type SegmentSummary,
  type TalentSelection,
} from "@wowpvp/core";
import { getRegion } from "../config";
import { createPool } from "../db/pool";
import { printCoverage } from "./coverage";
import { prune } from "./prune-aggregates";
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
 *
 * Y publica una tercera cosa además de las dos tablas de §28: la **cobertura
 * servible por par `(spec, segmento objetivo)`** (ADR 0032). Sale de los
 * mismos segmentos que se acaban de calcular y se escribe en la misma
 * transacción, porque es una lectura de esta corrida y de ninguna otra.
 */

const MS_PER_DAY = 86_400_000;

/**
 * Filas por INSERT al escribir `aggregate_snapshots`. Con 40 specs × brackets
 * × segmentos y una ingesta de perfiles que no para de rellenar gear, esa
 * tabla es la que crece sin techo: un `await` por variable convertía el
 * recálculo en miles de round-trips secuenciales a Postgres, hasta pasar de
 * dos minutos a no caber en la media hora del job. Mismo patrón que
 * `refresh-activity.ts`: unnest en lotes en vez de fila a fila.
 */
const WRITE_BATCH = 1_000;

/** ms legibles para el resumen de tiempos por fase, sin importar cuán grande. */
function formatDuration(ms: number): string {
  return ms >= 1_000 ? `${(ms / 1_000).toFixed(1)}s` : `${Math.round(ms)}ms`;
}

/**
 * Resumen de a qué fase se le fue el tiempo: sin esto, "la corrida tardó 21
 * minutos" no dice si el problema está en la consulta, en el cálculo o en la
 * escritura, y esa pregunta se contesta releyendo el job entero en vez de
 * mirando su salida.
 *
 * El total es reloj de pared y no la suma de las fases, para que cuadre con lo
 * que mide quien lo ejecuta. Las fases no lo cubren entero —queda fuera
 * resolver la temporada y la impresión— y esa diferencia es informativa: si
 * sobra tiempo sin atribuir, está en algo que no se está midiendo.
 */
function printPhaseTimings(phases: Record<string, number>, elapsedMs: number): void {
  const parts = Object.entries(phases).map(([name, ms]) => `${name} ${formatDuration(ms)}`);
  console.log(`\nTiempos: ${parts.join(" · ")} · corrida ${formatDuration(elapsedMs)}.`);
}

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
  /** null = el snapshot no trae nodos, no que el personaje no tenga (regla 5). */
  talents: TalentSelection[] | null;
  pvpTalents: TalentSelection[] | null;
  heroTalentTree: HeroTreeSelection | null;
  gearBySlot: Map<string, number>;
  /**
   * Gemas y encantamientos de todo el equipo, ya sin el hueco del que salen: se
   * agregan sin slot (ADR 0027). Listas vacías y no null, porque su
   * disponibilidad es la del gear — si el perfil no trae equipo, no hay filas de
   * las que sacarlas y el personaje ya sale del denominador por `gearBySlot`.
   */
  gems: GearSelection[];
  enchantments: GearSelection[];
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
      gems: profile?.gems ?? [],
      enchantments: profile?.enchantments ?? [],
      talentLoadoutCode: profile?.talentLoadoutCode ?? null,
      talents: profile?.talents ?? null,
      pvpTalents: profile?.pvpTalents ?? null,
      heroTalentTree: profile?.heroTalentTree ?? null,
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
export async function resolveSeason(
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

/**
 * Acumula ids y nombres paralelos de una fila de gear en la lista del snapshot.
 *
 * Los nombres pueden venir cortos: los snapshots anteriores a la migración 0013
 * traen los ids y el array vacío, y esa gema entra igual con el nombre a null —
 * la adopción se cuenta por id y la etiqueta se rellena cuando vuelva a
 * observarse (regla 5).
 */
function collectSelections(
  target: Map<string, GearSelection[]>,
  snapshotId: string,
  ids: readonly number[] | null,
  names: readonly (string | null)[] | null,
): void {
  const list = target.get(snapshotId) ?? [];
  (ids ?? []).forEach((id, index) => list.push({ id, name: names?.[index] ?? null }));
  if (list.length > 0) target.set(snapshotId, list);
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
    hero_talent_tree_id: number | null;
    hero_talent_tree_name: string | null;
  }>(
    `select distinct on (s.character_id, s.bracket)
            s.id, s.character_id, s.bracket, s.captured_at,
            s.average_item_level, s.equipped_item_level, s.talent_loadout_code,
            s.hero_talent_tree_id, s.hero_talent_tree_name
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
    gem_item_ids: number[];
    gem_item_names: (string | null)[];
    enchantment_ids: number[];
    enchantment_names: (string | null)[];
  }>(
    `select g.snapshot_id, g.slot, g.item_id, g.item_name,
            g.gem_item_ids, g.gem_item_names, g.enchantment_ids, g.enchantment_names
       from character_snapshot_gear g
      where g.snapshot_id = any($1::bigint[])`,
    [snapshots.map((row) => row.id)],
  );

  // Misma forma que la consulta de gear: los nodos cuelgan del snapshot, y se
  // piden en bloque para los snapshots que ya sabemos que entran.
  const { rows: talentRows } = await pool.query<{
    snapshot_id: string;
    tree: string;
    talent_id: string;
    talent_name: string | null;
  }>(
    `select t.snapshot_id, t.tree, t.talent_id, t.talent_name
       from character_snapshot_talents t
      where t.snapshot_id = any($1::bigint[])`,
    [snapshots.map((row) => row.id)],
  );

  // Nodos y talentos PvP se separan aquí y no en la consulta porque tienen
  // denominadores distintos: un snapshot puede traer el loadout entero y no los
  // talentos PvP, o al revés (ADR 0026). Fundirlos en una lista los ataría.
  const talentsBySnapshot = new Map<string, TalentSelection[]>();
  const pvpBySnapshot = new Map<string, TalentSelection[]>();
  for (const row of talentRows) {
    const selection: TalentSelection = {
      tree: row.tree as TalentSelection["tree"],
      talentId: Number(row.talent_id),
      talentName: row.talent_name,
    };
    const target = row.tree === "pvp" ? pvpBySnapshot : talentsBySnapshot;
    const list = target.get(row.snapshot_id);
    if (list) list.push(selection);
    else target.set(row.snapshot_id, [selection]);
  }

  const gearBySnapshot = new Map<string, Map<string, number>>();
  const gemsBySnapshot = new Map<string, GearSelection[]>();
  const enchantsBySnapshot = new Map<string, GearSelection[]>();
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

    // Las gemas se acumulan del equipo entero y pierden el slot aquí: la
    // pregunta que responde su adoption_rate es "¿la lleva?", no "¿dónde"
    // (ADR 0027). El nombre viaja con ellas porque, al contrario que el del
    // item, no está en ninguna otra columna que se pueda consultar después.
    collectSelections(gemsBySnapshot, row.snapshot_id, row.gem_item_ids, row.gem_item_names);
    collectSelections(
      enchantsBySnapshot,
      row.snapshot_id,
      row.enchantment_ids,
      row.enchantment_names,
    );
  }

  const profiles = snapshots.map((row) => ({
    characterId: row.character_id,
    bracket: row.bracket,
    capturedAt: row.captured_at,
    equippedItemLevel: row.equipped_item_level,
    averageItemLevel: row.average_item_level,
    talentLoadoutCode: row.talent_loadout_code,
    // `?? null` y no `?? []`: sin filas no sabemos si el personaje no tiene
    // nodos o si el snapshot es anterior al ADR 0026. Sale del denominador.
    talents: talentsBySnapshot.get(row.id) ?? null,
    pvpTalents: pvpBySnapshot.get(row.id) ?? null,
    heroTalentTree:
      row.hero_talent_tree_id !== null && row.hero_talent_tree_name !== null
        ? { id: row.hero_talent_tree_id, name: row.hero_talent_tree_name }
        : null,
    gearBySlot: gearBySnapshot.get(row.id) ?? new Map<string, number>(),
    gems: gemsBySnapshot.get(row.id) ?? [],
    enchantments: enchantsBySnapshot.get(row.id) ?? [],
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

// --- Cobertura servible ---

/**
 * Los pares `(spec, segmento objetivo)` de esta corrida (ADR 0032).
 *
 * No consulta nada: sale de los mismos segmentos que se acaban de calcular, así
 * que la cobertura publicada describe exactamente la corrida que la acompaña y
 * no una foto sacada después con otra ventana.
 *
 * El emparejamiento y la puerta viven en core, no aquí: quién es el objetivo de
 * quién es la escala (`nextSegment`) y qué se puede servir es
 * `canShowComparison()` sobre el `gear_sample` del objetivo (ADR 0010).
 */
export function coverageOf(segments: readonly ComputedSegment[]): CoveragePair[] {
  return buildCoverage(
    segments.map((segment) => ({
      bracket: segment.bracket,
      classSlug: segment.classSlug,
      specSlug: segment.specSlug,
      segmentMin: segment.segmentMin,
      sampleSize: segment.summary.sampleSize,
      gearSample: segment.summary.gearSample,
      activityWindowDays: segment.window,
    })),
    DEFAULT_SEGMENT_SCALE,
  );
}

// --- Escritura ---

/** Una variable ya resuelta a su `population_segment_id`, lista para el insert masivo. */
interface PendingVariable {
  segmentRowId: string;
  variable: AggregatedVariable;
}

/**
 * Escribe `aggregate_snapshots` en lotes de `WRITE_BATCH` con `unnest`, en vez
 * de un `INSERT` por variable: esa tabla es la que crece con las 40 specs y con
 * una ingesta continua que no va a dejar de rellenar perfiles, así que es ahí
 * donde el número de round-trips tenía que dejar de escalar 1:1 con la
 * población.
 */
async function writeVariables(
  client: pg.PoolClient,
  pending: readonly PendingVariable[],
  itemNames: Map<number, string>,
): Promise<void> {
  for (let i = 0; i < pending.length; i += WRITE_BATCH) {
    const batch = pending.slice(i, i + WRITE_BATCH);
    await client.query(
      `insert into aggregate_snapshots
         (population_segment_id, variable_kind, variable_key, slot_group, item_id,
          item_name, talent_tree, talent_id, talent_name,
          enchantment_id, enchantment_name,
          users, denominator, unavailable, adoption_rate)
       select * from unnest(
         $1::bigint[], $2::text[], $3::text[], $4::text[], $5::bigint[],
         $6::text[], $7::text[], $8::bigint[], $9::text[],
         $10::bigint[], $11::text[],
         $12::int[], $13::int[], $14::int[], $15::double precision[]
       )`,
      [
        batch.map((p) => p.segmentRowId),
        batch.map((p) => p.variable.kind),
        batch.map((p) => p.variable.key),
        batch.map((p) => p.variable.slotGroup),
        batch.map((p) => p.variable.itemId),
        // El nombre observado manda sobre el del catálogo: la gema lo trae
        // consigo y el item equipado no, así que ninguna de las dos vías sirve
        // para las dos.
        batch.map(
          (p) =>
            p.variable.itemName ??
            (p.variable.itemId === null ? null : (itemNames.get(p.variable.itemId) ?? null)),
        ),
        batch.map((p) => p.variable.talentTree),
        batch.map((p) => p.variable.talentId),
        batch.map((p) => p.variable.talentName),
        batch.map((p) => p.variable.enchantmentId),
        batch.map((p) => p.variable.enchantmentName),
        batch.map((p) => p.variable.adoption.users),
        batch.map((p) => p.variable.adoption.denominator),
        batch.map((p) => p.variable.adoption.unavailable),
        batch.map((p) => p.variable.adoption.value),
      ],
    );
  }
}

/**
 * Escribe la cobertura de la corrida, también en lotes con `unnest`.
 *
 * Va dentro de la misma transacción que los segmentos porque comparten
 * `computed_at` y se leen juntas: una corrida a medias dejaría una cobertura que
 * dice "21 pares servibles" junto a unos agregados que no son los que la
 * produjeron, y nada distinguiría una cosa de la otra al leerlo.
 */
async function writeCoverage(
  client: pg.PoolClient,
  region: string,
  seasonId: number,
  computedAt: Date,
  pairs: readonly CoveragePair[],
): Promise<void> {
  for (let i = 0; i < pairs.length; i += WRITE_BATCH) {
    const batch = pairs.slice(i, i + WRITE_BATCH);
    await client.query(
      `insert into segment_coverage
         (computed_at, region, season_id, bracket, class_slug, spec_slug,
          subject_segment_id, subject_segment_min, subjects,
          segment_id, segment_min, segment_max,
          sample_size, gear_sample, activity_window_days)
       select $1::timestamptz, $2::text, $3::int, * from unnest(
         $4::text[], $5::text[], $6::text[],
         $7::text[], $8::int[], $9::int[],
         $10::text[], $11::int[], $12::int[],
         $13::int[], $14::int[], $15::int[]
       )`,
      [
        computedAt,
        region,
        seasonId,
        batch.map((pair) => pair.bracket),
        batch.map((pair) => pair.classSlug),
        batch.map((pair) => pair.specSlug),
        batch.map((pair) => pair.subject.id),
        batch.map((pair) => pair.subject.min),
        batch.map((pair) => pair.subjects),
        batch.map((pair) => pair.target.id),
        batch.map((pair) => pair.target.min),
        // El tramo abierto de arriba no tiene máximo, y no se finge uno.
        batch.map((pair) => (Number.isFinite(pair.target.max) ? pair.target.max : null)),
        batch.map((pair) => pair.targetSampleSize),
        batch.map((pair) => pair.targetGearSample),
        batch.map((pair) => pair.targetWindow),
      ],
    );
  }
}

/**
 * Todas las filas de una corrida entran o no entra ninguna.
 *
 * En una transacción porque el consumidor lee "el computed_at más reciente de
 * este segmento": una corrida a medias dejaría unos brackets con agregado nuevo
 * y otros con el de ayer bajo la misma marca temporal, y nada distinguiría una
 * cosa de la otra al leerlo.
 *
 * `population_segments` se sigue insertando fila a fila: son unos cientos como
 * mucho (un `computed_at` por bracket × segmento) y hace falta el id de vuelta
 * para poder enlazar sus variables. El volumen real — y el que crecía sin
 * límite — está en `aggregate_snapshots`, que se acumula aquí y se escribe de
 * una vez con `writeVariables`.
 */
async function writeSegments(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  computedAt: Date,
  segments: readonly ComputedSegment[],
  coverage: readonly CoveragePair[],
  itemNames: Map<number, string>,
): Promise<{ variables: number }> {
  const client = await pool.connect();
  const pending: PendingVariable[] = [];

  try {
    await client.query("begin");

    for (const segment of segments) {
      const { summary } = segment;
      const { rows } = await client.query<{ id: string }>(
        `insert into population_segments
           (computed_at, region, season_id, bracket, class_slug, spec_slug,
            segment_id, segment_min, segment_max, activity_window_days,
            sample_size, rating_median, rating_p25, rating_p75,
            rating_min, rating_max, equipped_item_level_median,
            item_level_sample, gear_sample, talent_sample, talent_code_distinct,
            talent_node_sample, pvp_talent_sample,
            profile_data_from, profile_data_to, excluded_search,
            active_by_delta, active_by_first_seen)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28)
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
          summary.ratingMedian,
          summary.ratingP25,
          summary.ratingP75,
          summary.ratingMin,
          summary.ratingMax,
          summary.equippedItemLevelMedian,
          summary.itemLevelSample,
          summary.gearSample,
          summary.talentSample,
          summary.talentCodeDistinct,
          summary.talentNodeSample,
          summary.pvpTalentSample,
          segment.profileFrom,
          segment.profileTo,
          segment.excludedSearch,
          segment.activeByDelta,
          segment.activeByFirstSeen,
        ],
      );

      const segmentRowId = rows[0]?.id;
      if (!segmentRowId) throw new Error(`No se pudo insertar el segmento ${segment.segmentId}.`);

      for (const variable of segment.variables) pending.push({ segmentRowId, variable });
    }

    await writeVariables(client, pending, itemNames);
    await writeCoverage(client, region, seasonId, computedAt, coverage);

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  return { variables: pending.length };
}

// --- Salida ---

function printSegments(segments: readonly ComputedSegment[]): void {
  console.log("\n=== AGREGADOS POR SEGMENTO ===");
  console.log(
    "(confianza de POBLACIÓN según §13.4: high n≥100, medium n≥30. La de la " +
      "comparación sale del gear, que tiene su propio denominador)\n",
  );

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
      `  ${label}: n=${summary.sampleSize} (${confidenceFor(summary.sampleSize)}, ` +
        `ventana ${segment.window}d, ` +
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
  // Tiempo por fase: la corrida creció hasta no caber en su job sin que nadie
  // supiera en qué se iba. No se guarda en ningún sitio a propósito — es
  // diagnóstico de esta corrida, no una métrica histórica.
  const startedAt = Date.now();
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
    const activityStart = Date.now();
    printActivitySummary(
      await rebuildActivity(pool, region, seasonId, now, { dryRun: options.dryRun }),
    );
    const activityMs = Date.now() - activityStart;
    if (options.dryRun) {
      console.log(
        "(--dry-run: la actividad no se ha escrito; los segmentos de abajo se filtran con la " +
          "que ya hubiera en character_activity)",
      );
    }
    console.log("");

    const loadStart = Date.now();
    const [active, searchOnly, { profiles, itemNames }] = await Promise.all([
      loadActive(pool, region, seasonId, cutoff),
      loadSearchOnly(pool, region, seasonId, cutoff),
      loadProfiles(pool, region, seasonId, cutoff),
    ]);
    const loadMs = Date.now() - loadStart;

    console.log(
      `Población cargada: ${active.length} personajes activos, ${profiles.length} con perfil completo` +
        `${searchOnly.length > 0 ? `, ${searchOnly.length} excluidos por venir solo de búsqueda` : ""}.`,
    );

    const computeStart = Date.now();
    const members = buildMembers(active, profiles);
    const segments = computeSegments(members, searchOnly, now, options.window);
    const computeMs = Date.now() - computeStart;
    if (segments.length === 0) {
      throw new Error(
        `Ningún segmento tiene población dentro de la ventana de ${widest} días. ` +
          `Puede ser que no esté corriendo el job de leaderboard, o que character_activity ` +
          `esté vacía para esta temporada (con --dry-run no se escribe): ` +
          `npm run pipeline -- refresh-activity`,
      );
    }

    printSegments(segments);

    const coverage = coverageOf(segments);
    printCoverage(coverage);

    if (options.dryRun) {
      const variables = segments.reduce((acc, s) => acc + s.variables.length, 0);
      console.log(
        `--dry-run: no se ha escrito nada (serían ${segments.length} segmentos, ${variables} ` +
          `variables y ${coverage.length} pares de cobertura).`,
      );
      printPhaseTimings(
        { actividad: activityMs, carga: loadMs, cálculo: computeMs },
        Date.now() - startedAt,
      );
      return;
    }

    const writeStart = Date.now();
    const computedAt = new Date();
    const { variables } = await writeSegments(
      pool,
      region,
      seasonId,
      computedAt,
      segments,
      coverage,
      itemNames,
    );
    const writeMs = Date.now() - writeStart;

    console.log(
      `${segments.length} segmentos, ${variables} variables y ${coverage.length} pares de ` +
        `cobertura escritos con computed_at ${computedAt.toISOString()}.`,
    );
    printPhaseTimings(
      { actividad: activityMs, carga: loadMs, cálculo: computeMs, escritura: writeMs },
      Date.now() - startedAt,
    );

    // La cobertura de perfiles es la limitación que decide si estos agregados
    // sirven para algo más que la distribución: sin perfiles no hay
    // adoption_rate, y eso no debe descubrirse leyendo una tabla vacía.
    const withProfiles = segments.filter((s) => s.summary.gearSample > 0).length;
    if (withProfiles === 0) {
      console.log(
        "\n⚠️  Ningún segmento tiene perfiles en la ventana: solo se ha publicado la " +
          "distribución de población. Para que haya adoption_rate tiene que estar corriendo " +
          "refresh-profiles, que es quien mantiene perfiles dentro de la ventana.",
      );
    } else {
      console.log(
        `Cobertura de perfiles: ${withProfiles}/${segments.length} segmentos con adoption_rate.`,
      );
    }

    // La poda va aquí y no en un job aparte porque la corrida que acaba de
    // escribirse es justo la que hay que respetar entera: separarlas dejaría una
    // ventana en la que el detalle por variable de la corrida vigente depende de
    // que alguien se acuerde de lanzar el segundo comando.
    const pruned = await prune(pool, { minUsers: 5, dryRun: false });
    if (pruned.deleted > 0) {
      console.log(
        `Retención: ${pruned.deleted.toLocaleString("es-ES")} filas de agregados ` +
          `de corridas anteriores podadas (quedan ` +
          `${(pruned.before - pruned.deleted).toLocaleString("es-ES")}).`,
      );
    }
  } finally {
    // El pool prestado lo cierra quien lo abrió: cerrarlo aquí dejaría sin base
    // a lo que venga después en la misma corrida.
    if (!borrowedPool) await pool.end();
  }
}
