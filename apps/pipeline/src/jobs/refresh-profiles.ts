import type pg from "pg";
import {
  ACTIVITY_WINDOWS,
  DEFAULT_SEGMENT_SCALE,
  ICP_RATING_RANGE,
  MIN_SAMPLE_HIGH,
  MIN_SAMPLE_MEDIUM,
  canShowComparison,
  formatSegment,
  isActiveWithin,
  isArenaBracket,
  parseShuffleBracket,
  pickActivityWindow,
  segmentFor,
  servesIcpSubjects,
  shuffleBracketId,
  type ActivityWindowDays,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import {
  BlizzardClient,
  activeSpecOf,
  blizzardUsage,
  findTalentLoadout,
  formatUsage,
  mapEquipment,
  mapPvpTalents,
  markCharactersVerified,
} from "@wowpvp/blizzard";
import {
  getArenaBrackets,
  getBlizzardCredentials,
  getDatabaseUrl,
  getProfileRefreshArenaShare,
  getProfileRefreshBudget,
  getRegion,
  parseArenaShare,
} from "../config";
import { createPool } from "../db/pool";
import { takeSample } from "../sampling";
import { SHUFFLE_BRACKETS_LIKE } from "../specs-to-ingest";
import { REQUESTS_PER_PROFILE, fetchProfileParts, saveProfileSnapshot } from "./profile-capture";
import { printActivitySummary, rebuildActivity } from "./refresh-activity";
import { resolveSeason } from "./refresh-aggregates";
import { parseSpecSelection } from "./sample-profiles";

/**
 * Ingesta continua de perfiles por segmento (issue #66).
 *
 * `sample-profiles` es muestreo de Sprint 0: una foto, congelada en un
 * manifiesto en disco, que se pidió a mano una vez. Esto es lo otro — el job que
 * mantiene viva la base de comparación, y sin el cual `gear_sample` vuelve a
 * cero en cuanto los perfiles salen de la ventana de actividad.
 *
 * Su contrato lo fija el ADR 0010 (decisiones 4 a 6), y esta es la lectura
 * literal de cada una:
 *
 * - **Cuota por par `(bracket, segmento)`, no censo.** Objetivo
 *   `MIN_SAMPLE_HIGH` perfiles frescos por par, suelo `MIN_SAMPLE_MEDIUM` por
 *   debajo del cual el par no se sirve. No hay umbral nuevo: son los que ya
 *   viven en `packages/core`.
 * - **El gasto va de abajo arriba dentro del ICP**, ordenando por cuánta
 *   población hay en el segmento inmediatamente inferior. Un segmento objetivo
 *   sin sujetos debajo no sirve a nadie, y con el presupuesto apretado el orden
 *   decide a cuánta gente real alcanza el mismo número de peticiones. Las dos
 *   mitades de esa frase hacen falta: el orden por sí solo manda el presupuesto
 *   al fondo de la ladder, que al empezar una temporada es lo más poblado que
 *   hay y no le sirve a ningún jugador del público objetivo.
 * - **Solo la temporada vigente.** Rellenar con perfiles del reset anterior
 *   llenaría la pantalla con gear de otra temporada, que es exactamente la
 *   comparación que el producto promete no fabricar.
 *
 * Y una decisión que el ADR no tenía que tomar y sale de mirar cómo agrega
 * `refresh-aggregates`: **la ventana de cada par la elige `pickActivityWindow`,
 * la misma función que decide la del agregado**. Así el pool de candidatos es
 * exactamente la población que después se va a agregar. Con una ventana más
 * ancha se gastaría cuota en gente que no cuenta; con una más estrecha, el gear
 * del segmento quedaría sesgado hacia sus jugadores más activos — que es peor
 * que gastar de más, porque no se ve.
 *
 * **La arena va aparte, con su parte del presupuesto** (ADR 0049). Un par de
 * 2v2 o 3v3 es `(bracket, segmento)` con las cuarenta specs dentro, porque la
 * spec no se sabe hasta bajar el perfil (ADR 0048). Como par corriente pasaría
 * por delante de cualquier spec de Solo Shuffle por número de sujetos, y su
 * objetivo de 100 perfiles repartidos entre cuarenta specs no daría 30 en
 * ninguna. Por eso la arena tiene una cuota fija (`PROFILE_REFRESH_ARENA_SHARE`)
 * y dentro de ella se hace censo; lo que no gasta vuelve a Solo Shuffle.
 */

const MS_PER_DAY = 86_400_000;

/** Cada cuántos perfiles se imprime progreso. */
const PROGRESS_EVERY = 25;

/** Cuántos pares del plan se listan antes de resumir el resto. */
const PLAN_PREVIEW = 15;

/**
 * Semilla constante por defecto, no aleatoria: mientras un par tenga más
 * población que el objetivo, cada corrida vuelve a los mismos personajes en vez
 * de a una cohorte nueva. El histórico del segmento sigue así a la misma gente,
 * que es lo que hace legible una tendencia (#27).
 */
const DEFAULT_SEED = "refresh-profiles";

/** Ventanas que puede tener una comparación: 30 días es "season active", no meta actual. */
const SAMPLING_WINDOWS: readonly number[] = [ACTIVITY_WINDOWS.default, ACTIVITY_WINDOWS.fallback];

// --- Argumentos ---

export interface Options {
  /** Techo de peticiones de esta corrida. El plan se recorta para caber. */
  budget: number;
  seed: string;
  dryRun: boolean;
  /** Ventana forzada. null = la elige pickActivityWindow por par, como el agregado. */
  window: ActivityWindowDays | null;
  /**
   * Brackets de Solo Shuffle a los que acotar la corrida. null = todos los que
   * tengan población. Acotar deja fuera la arena, que no nombra spec.
   */
  specs: SpecEntry[] | null;
  /** Parte del presupuesto para la arena encendida (ADR 0049), entre 0 y 1. */
  arenaShare: number;
  /** Rating de entrada de los segmentos objetivo. null = todos. */
  segmentEntries: number[] | null;
}

export function parseOptions(
  args: string[],
  defaultBudget: number,
  defaultArenaShare: number,
): Options {
  const options: Options = {
    budget: defaultBudget,
    seed: DEFAULT_SEED,
    dryRun: false,
    window: null,
    specs: null,
    segmentEntries: null,
    arenaShare: defaultArenaShare,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--dry-run") {
      options.dryRun = true;
      continue;
    }
    if (!flag?.startsWith("--")) continue;

    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`La opción ${flag} necesita un valor.`);
    }
    i++;

    switch (flag) {
      case "--budget": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed) || parsed <= 0) {
          throw new Error(`--budget="${value}" debe ser un número de peticiones mayor que 0.`);
        }
        options.budget = parsed;
        break;
      }
      case "--seed":
        options.seed = value;
        break;
      case "--window": {
        const parsed = Number(value);
        if (!SAMPLING_WINDOWS.includes(parsed)) {
          throw new Error(
            `--window="${value}" debe ser ${SAMPLING_WINDOWS.join(" o ")}. La de 30 días es ` +
              `"season active" (ranking), no ventana de comparación: usarla mezclaría metas.`,
          );
        }
        options.window = parsed as ActivityWindowDays;
        break;
      }
      case "--specs":
        options.specs = parseSpecSelection(value);
        break;
      case "--arena-share":
        options.arenaShare = parseArenaShare(value, "--arena-share");
        break;
      case "--segments": {
        const entries = value.split(",").map((v) => Number(v.trim()));
        if (entries.some((v) => !Number.isFinite(v))) {
          throw new Error(`--segments="${value}" debe ser una lista de ratings, p.ej. 1800,2000.`);
        }
        options.segmentEntries = entries;
        break;
      }
      default:
        throw new Error(
          `Opción desconocida: ${flag}. Disponibles: --budget, --seed, --window, --specs, ` +
            `--segments, --arena-share, --dry-run.`,
        );
    }
  }

  return options;
}

// --- Estado de la base de comparación ---

/** Un personaje al que se le puede bajar el perfil. */
export interface Candidate {
  characterId: string;
  realmSlug: string;
  nameSlug: string;
  bracket: string;
  seasonId: number;
  rating: number;
  lastActiveAt: Date;
  /** Última vez que se le bajó el perfil en esta temporada. null = nunca. */
  lastProfileAt: Date | null;
}

/**
 * Lo que hay hoy en un par `(bracket, segmento)` y lo que se puede hacer con él.
 *
 * `fresh` es el `gear_sample` que tendría el agregado si corriera ahora: no la
 * población del segmento, sino su base de comparación real. Son cifras
 * distintas por tres órdenes de magnitud, y confundirlas es la mentira contra la
 * que existe el ADR 0007.
 */
export interface PairState {
  bracket: string;
  segment: RatingSegment;
  /** Ventana de actividad con la que se cuenta este par, elegida como en el agregado. */
  window: ActivityWindowDays;
  /** Activos con perfil dentro de la ventana. */
  fresh: number;
  /** Activos sin perfil fresco: a quién se le puede bajar, en orden estable. */
  stale: readonly Candidate[];
  /** Activos del segmento inmediatamente inferior: los sujetos a los que serviría. */
  subjectsBelow: number;
}

/**
 * ¿Cuenta el perfil de este personaje como base de comparación hoy?
 *
 * Mismo criterio que aplica `refresh-aggregates` al cargar perfiles: dentro de
 * la ventana del segmento y de la temporada vigente. Un perfil de hace tres
 * semanas existe en la base pero no suma en ningún denominador, así que para
 * este job es como si no estuviera.
 */
export function hasFreshProfile(
  candidate: Pick<Candidate, "lastProfileAt">,
  now: Date,
  window: ActivityWindowDays,
): boolean {
  if (!candidate.lastProfileAt) return false;
  return candidate.lastProfileAt.getTime() >= now.getTime() - window * MS_PER_DAY;
}

function pairKey(bracket: string, segmentId: string): string {
  return `${bracket}|${segmentId}`;
}

/**
 * Reparte la población activa en pares y calcula el estado de cada uno.
 *
 * La ventana se elige por par con `pickActivityWindow` (§13.4), no por bracket
 * ni por corrida: un mismo Frost Mage puede tener 7 días de sobra en 1800-2000 y
 * necesitar 14 en 2600-2800, y muestrear los dos con la misma ventana
 * significaría gastar cuota fuera de la población agregada en un caso y
 * sesgarla en el otro.
 */
export function buildPairs(
  candidates: readonly Candidate[],
  now: Date,
  forcedWindow: ActivityWindowDays | null,
): PairState[] {
  const byPair = new Map<string, { bracket: string; segment: RatingSegment; rows: Candidate[] }>();
  for (const candidate of candidates) {
    const segment = segmentFor(candidate.rating, DEFAULT_SEGMENT_SCALE);
    const key = pairKey(candidate.bracket, segment.id);
    const bucket = byPair.get(key);
    if (bucket) bucket.rows.push(candidate);
    else byPair.set(key, { bracket: candidate.bracket, segment, rows: [candidate] });
  }

  // Dos pasadas: primero la población de cada par dentro de su ventana, y solo
  // después los sujetos de debajo — que son la población del par inferior
  // contada con la ventana de ese par, no con la de este.
  const members = new Map<string, Candidate[]>();
  const windows = new Map<string, ActivityWindowDays>();
  for (const [key, { rows }] of byPair) {
    const inWindow = (days: ActivityWindowDays): Candidate[] =>
      rows.filter((row) => isActiveWithin(row, now, days));

    const window =
      forcedWindow ??
      pickActivityWindow({
        7: inWindow(ACTIVITY_WINDOWS.default).length,
        14: inWindow(ACTIVITY_WINDOWS.fallback).length,
      }).window;

    windows.set(key, window);
    members.set(key, inWindow(window));
  }

  const states: PairState[] = [];
  for (const [key, { bracket, segment }] of byPair) {
    const active = members.get(key) ?? [];
    const window = windows.get(key) ?? ACTIVITY_WINDOWS.fallback;
    // El segmento de debajo es el que contiene el rating justo anterior al
    // mínimo de este. Se le pregunta a segmentFor en vez de restar el tamaño de
    // la escala a mano: la escala es un parámetro y cambia por temporada.
    const below = segment.min > 0 ? segmentFor(segment.min - 1, DEFAULT_SEGMENT_SCALE) : null;

    states.push({
      bracket,
      segment,
      window,
      fresh: active.filter((row) => hasFreshProfile(row, now, window)).length,
      stale: active.filter((row) => !hasFreshProfile(row, now, window)),
      subjectsBelow: below ? (members.get(pairKey(bracket, below.id))?.length ?? 0) : 0,
    });
  }

  return states;
}

// --- Plan de gasto ---

export interface PlannedPair {
  state: PairState;
  /** Perfiles que se bajan en esta corrida. */
  profiles: number;
  /** De ellos, cuántos son para llegar al suelo; el resto sube hacia el objetivo. */
  toFloor: number;
}

export interface RunPlan {
  pairs: PlannedPair[];
  profiles: number;
  requests: number;
  /** De esos perfiles, cuántos van a pares que sirven a sujetos del ICP. */
  icpProfiles: number;
  /** Pares descartados por no tener a nadie debajo: su gear no serviría a ningún sujeto. */
  servesNobody: number;
  /** Pares que se quedan sin llegar al suelo porque se acabó el presupuesto. */
  shortOfBudget: number;
  /** Pares que no llegarían al suelo ni con presupuesto infinito: no hay tanta gente. */
  shortOfPopulation: number;
}

/**
 * Qué se baja en esta corrida, dado un presupuesto de peticiones.
 *
 * Dos pasadas sobre el mismo orden: primero el **suelo** (`MIN_SAMPLE_MEDIUM`)
 * en todos los pares que puedan alcanzarlo, y solo después se sube hacia el
 * **objetivo** (`MIN_SAMPLE_HIGH`). Es una decisión de producto y no una
 * optimización: el mínimo de lanzamiento se cuenta en pares servibles
 * (ADR 0010), así que con el presupuesto corto vale más tener muchos pares en
 * confianza `medium` que unos pocos en `high` y el resto sin comparación
 * ninguna. Lo que se declara no cambia: la fila dirá `medium` y el consumidor la
 * pintará como tal.
 *
 * El orden es el de la decisión 5 del ADR 0010: más sujetos debajo primero. Los
 * empates se rompen por bracket y por rating para que dos corridas con el mismo
 * estado planifiquen lo mismo.
 */
export function planRun(states: readonly PairState[], budgetRequests: number): RunPlan {
  const eligible = states.filter((state) => state.subjectsBelow > 0);
  const ordered = [...eligible].sort(
    (a, b) =>
      b.subjectsBelow - a.subjectsBelow ||
      a.bracket.localeCompare(b.bracket) ||
      a.segment.min - b.segment.min,
  );

  let remaining = Math.floor(budgetRequests / REQUESTS_PER_PROFILE);
  const taken = new Map<string, number>();
  const floorTaken = new Map<string, number>();

  /**
   * Sube hasta `ceiling` perfiles frescos los pares del ámbito pedido, hasta
   * donde llegue el presupuesto.
   */
  const fill = (ceiling: number, scope: "icp" | "resto"): void => {
    const isFloor = ceiling === MIN_SAMPLE_MEDIUM;

    for (const state of ordered) {
      if (remaining <= 0) return;
      if (servesIcpSubjects(state.segment, DEFAULT_SEGMENT_SCALE) !== (scope === "icp")) continue;

      const key = pairKey(state.bracket, state.segment.id);
      const already = taken.get(key) ?? 0;
      // No se puede pasar de la gente que hay: un par con 12 activos se queda en
      // 12, y eso es el hallazgo (ADR 0010), no un hueco que rellenar.
      const reachable = Math.min(ceiling, state.fresh + state.stale.length);
      const need = reachable - state.fresh - already;
      if (need <= 0) continue;

      const take = Math.min(need, remaining);
      taken.set(key, already + take);
      if (isFloor) floorTaken.set(key, (floorTaken.get(key) ?? 0) + take);
      remaining -= take;
    }
  };

  // El ICP entero antes que nada de fuera, y dentro de cada ámbito el suelo
  // antes que el objetivo. El orden por sujetos debajo no basta por sí solo:
  // al empezar una temporada el fondo de la ladder es lo más poblado que hay
  // —200-600 tiene cientos de personas por bracket— y se llevaría el
  // presupuesto entero sin servir a un solo jugador del público objetivo.
  fill(MIN_SAMPLE_MEDIUM, "icp");
  fill(MIN_SAMPLE_HIGH, "icp");
  fill(MIN_SAMPLE_MEDIUM, "resto");
  fill(MIN_SAMPLE_HIGH, "resto");

  const pairs: PlannedPair[] = [];
  let shortOfBudget = 0;
  let shortOfPopulation = 0;

  for (const state of ordered) {
    const key = pairKey(state.bracket, state.segment.id);
    const profiles = taken.get(key) ?? 0;
    if (profiles > 0) {
      pairs.push({ state, profiles, toFloor: floorTaken.get(key) ?? 0 });
    }

    if (state.fresh + profiles >= MIN_SAMPLE_MEDIUM) continue;
    if (state.fresh + state.stale.length < MIN_SAMPLE_MEDIUM) shortOfPopulation++;
    else shortOfBudget++;
  }

  // Se listan en el orden en que se gastó el presupuesto, no en el del recorrido:
  // lo primero que se lee tiene que ser lo primero que se paga.
  pairs.sort(
    (a, b) =>
      Number(servesIcpSubjects(b.state.segment, DEFAULT_SEGMENT_SCALE)) -
        Number(servesIcpSubjects(a.state.segment, DEFAULT_SEGMENT_SCALE)) ||
      b.state.subjectsBelow - a.state.subjectsBelow,
  );

  const profiles = pairs.reduce((total, pair) => total + pair.profiles, 0);
  const icpProfiles = pairs
    .filter((pair) => servesIcpSubjects(pair.state.segment, DEFAULT_SEGMENT_SCALE))
    .reduce((total, pair) => total + pair.profiles, 0);

  return {
    pairs,
    profiles,
    icpProfiles,
    requests: profiles * REQUESTS_PER_PROFILE,
    servesNobody: states.length - eligible.length,
    shortOfBudget,
    shortOfPopulation,
  };
}

/** Lo que se baja de arena en esta corrida: censo dentro de su cuota (ADR 0049). */
export interface ArenaPlan {
  pairs: PlannedPair[];
  profiles: number;
  requests: number;
  /** Activos sin perfil fresco que se quedan fuera por la cuota, en pares que sirven a alguien. */
  pending: number;
  /** Pares sin nadie debajo, que no se muestrean por lo mismo que en Solo Shuffle. */
  servesNobody: number;
}

/**
 * Censo de los pares de arena, hasta donde llegue su cuota.
 *
 * Sin objetivo ni suelo por par: los de Solo Shuffle hablan de un par
 * `(spec, segmento)`, y en arena la spec la trae el perfil, así que 100 perfiles
 * de `(3v3, 2000-2200)` serían unos pocos por spec y ninguna llegaría a 30. Lo
 * único que da base por spec es bajárselo a todos los activos del tramo. El
 * orden sí es el de Solo Shuffle: el ICP antes que nada de fuera y, dentro,
 * más sujetos debajo primero. Los sujetos cuentan las cuarenta specs, que entre
 * pares de arena es una comparación justa.
 */
export function planArenaCensus(states: readonly PairState[], budgetRequests: number): ArenaPlan {
  const eligible = states.filter((state) => state.subjectsBelow > 0);
  const ordered = [...eligible].sort(
    (a, b) =>
      Number(servesIcpSubjects(b.segment, DEFAULT_SEGMENT_SCALE)) -
        Number(servesIcpSubjects(a.segment, DEFAULT_SEGMENT_SCALE)) ||
      b.subjectsBelow - a.subjectsBelow ||
      a.bracket.localeCompare(b.bracket) ||
      a.segment.min - b.segment.min,
  );

  let remaining = Math.floor(budgetRequests / REQUESTS_PER_PROFILE);
  const pairs: PlannedPair[] = [];
  let pending = 0;
  for (const state of ordered) {
    const take = Math.min(state.stale.length, remaining);
    remaining -= take;
    pending += state.stale.length - take;
    // Sin suelo por par no hay perfiles "para llegar al suelo": todo es censo.
    if (take > 0) pairs.push({ state, profiles: take, toFloor: 0 });
  }

  const profiles = pairs.reduce((total, pair) => total + pair.profiles, 0);
  return {
    pairs,
    profiles,
    requests: profiles * REQUESTS_PER_PROFILE,
    pending,
    servesNobody: states.length - eligible.length,
  };
}

export interface ProfilePlan {
  shuffle: RunPlan;
  arena: ArenaPlan;
}

/**
 * El plan entero: la arena con su cuota y Solo Shuffle con el resto.
 *
 * La arena se planifica primero solo para saber cuánto gasta: lo que no use de
 * su cuota vuelve a Solo Shuffle en la misma corrida, así que con la arena
 * apagada, o ya al día, el reparto es el de siempre.
 */
export function planProfiles(
  states: readonly PairState[],
  budgetRequests: number,
  arenaShare: number,
): ProfilePlan {
  const arena = planArenaCensus(
    states.filter((state) => isArenaBracket(state.bracket)),
    Math.floor(budgetRequests * arenaShare),
  );
  const shuffle = planRun(
    states.filter((state) => !isArenaBracket(state.bracket)),
    budgetRequests - arena.requests,
  );
  return { shuffle, arena };
}

// --- Carga desde Postgres ---

/**
 * Población activa de la temporada vigente con la fecha de su último perfil.
 *
 * Es la misma población que agrega `refresh-aggregates`: última observación de
 * rating por `(personaje, bracket)`, cruzada contra `character_activity` porque
 * sin serie de partidas no se puede afirmar que alguien haya jugado, y sin
 * `source = 'search'`, que está fuera del denominador por el ADR 0007. Bajarle
 * el perfil a quien no va a entrar en el agregado sería gastar cuota en un
 * número que nadie va a ver.
 */
async function loadCandidates(
  pool: pg.Pool,
  region: string,
  seasonId: number,
  cutoff: Date,
  arenaBrackets: readonly string[],
): Promise<Candidate[]> {
  const { rows } = await pool.query<{
    character_id: string;
    realm_slug: string;
    name_slug: string;
    bracket: string;
    season_id: number;
    rating: number;
    last_active_at: Date;
    last_profile_at: Date | null;
  }>(
    `with active as (
       select distinct on (s.character_id, s.bracket)
              s.character_id, s.bracket, s.season_id, s.rating, a.last_active_at
         from character_snapshots s
         join characters c on c.id = s.character_id
         join character_activity a
           on a.character_id = s.character_id and a.bracket = s.bracket
          and a.season_id = s.season_id
        where c.region = $1 and s.season_id = $2 and s.captured_at >= $3
          and s.source <> 'search'
          and (s.bracket like '${SHUFFLE_BRACKETS_LIKE}' or s.bracket = any($4::text[]))
        order by s.character_id, s.bracket, s.captured_at desc
     ),
     profiles as (
       select s.character_id, s.bracket, max(s.captured_at) as last_profile_at
         from character_snapshots s
        where s.season_id = $2 and s.source = 'profile' and s.captured_at >= $3
          and (s.bracket like '${SHUFFLE_BRACKETS_LIKE}' or s.bracket = any($4::text[]))
        group by s.character_id, s.bracket
     )
     select a.character_id, a.bracket, a.season_id, a.rating, a.last_active_at,
            c.realm_slug, c.name_slug, p.last_profile_at
       from active a
       join characters c on c.id = a.character_id
       left join profiles p
         on p.character_id = a.character_id and p.bracket = a.bracket
      order by a.character_id, a.bracket`,
    [region, seasonId, cutoff, arenaBrackets],
  );

  return rows.map((row) => ({
    characterId: row.character_id,
    realmSlug: row.realm_slug,
    nameSlug: row.name_slug,
    bracket: row.bracket,
    seasonId: row.season_id,
    rating: row.rating,
    lastActiveAt: row.last_active_at,
    lastProfileAt: row.last_profile_at,
  }));
}

// --- Ejecución ---

interface RunReport {
  profiles: number;
  snapshots: number;
  gearRows: number;
  withTalentCode: number;
  /**
   * Perfiles de los que se guardaron nodos y talentos PvP. Aparte de
   * `withTalentCode` porque son tres denominadores que divergen: el código está
   * guardado desde agosto de 2026 y los nodos empiezan con el ADR 0026, así que
   * vigilar cómo se acercan es el único modo de saber cuándo hay base.
   */
  withTalentNodes: number;
  withPvpTalents: number;
  /** Ya no aparecen en su bracket: rotación, que es un dato y no un error. */
  noRating: number;
  /**
   * De arena, sin spec activa que el catálogo reconozca. No se guardan: la spec
   * de una observación de arena es la del perfil, y sin ella no hay con qué
   * (ADR 0048).
   */
  noSpec: number;
  apiErrors: number;
  /** Su rating de perfil ya no cae en el segmento por el que se les eligió. */
  movedSegment: number;
}

/**
 * Baja los perfiles planificados de un par y los escribe.
 *
 * El `capturedAt` es el de la corrida entera y nunca `now()`: repetirla choca
 * contra `idx_snapshots_unique_capture` en vez de duplicar población, y la
 * población duplicada infla los tamaños de muestra y con ellos la confianza que
 * declaramos.
 *
 * `bracketSpec` es la spec que nombra el bracket, o null en arena, donde la pone
 * el `active_spec` de cada perfil (ADR 0048).
 */
async function refreshPair(
  client: BlizzardClient,
  pool: pg.Pool,
  planned: PlannedPair,
  bracketSpec: SpecEntry | null,
  capturedAt: string,
  seed: string,
  report: RunReport,
): Promise<void> {
  const { state } = planned;
  const chosen = takeSample(
    state.stale,
    planned.profiles,
    `${seed}|${state.bracket}|${state.segment.id}`,
  );

  console.log(
    `→ ${bracketSpec?.label ?? state.bracket} ${formatSegment(state.segment)}: ` +
      `${state.fresh} frescos, ` +
      `bajando ${chosen.length} (ventana ${state.window}d, ${state.subjectsBelow} sujetos debajo)...`,
  );

  let done = 0;
  const verified: string[] = [];
  for (const candidate of chosen) {
    const parts = await fetchProfileParts(client, {
      realmSlug: candidate.realmSlug,
      nameSlug: candidate.nameSlug,
      bracket: state.bracket,
    });
    report.profiles++;
    done++;
    if (done % PROGRESS_EVERY === 0) console.log(`   ${done}/${chosen.length}`);

    // Blizzard acaba de devolver su perfil: existe, tenga o no rating en este
    // bracket (ADR 0043).
    if (parts.profile.status === 200) verified.push(candidate.characterId);

    if (
      parts.profile.status !== 200 ||
      parts.equipment.status !== 200 ||
      parts.specializations.status !== 200
    ) {
      report.apiErrors++;
    }

    // Sin rating no hay snapshot que insertar (la columna es not null). Suele
    // significar que el personaje ha dejado de jugar este bracket: es rotación,
    // un dato más, y sale del denominador en vez de contarse como un cero.
    const stats = parts.bracketStats.data;
    if (typeof stats?.rating !== "number") {
      report.noRating++;
      continue;
    }

    // El rating del perfil manda sobre el del leaderboard que motivó elegirlo:
    // si ha cambiado de segmento, su gear cuenta en el nuevo. Se anota porque
    // explica que un par no llegue a su objetivo aunque se gastara lo previsto.
    if (segmentFor(stats.rating, DEFAULT_SEGMENT_SCALE).id !== state.segment.id) {
      report.movedSegment++;
    }

    const spec = bracketSpec ?? (parts.profile.data ? activeSpecOf(parts.profile.data) : null);
    if (!spec) {
      report.noSpec++;
      continue;
    }

    // Un fallo del endpoint no es una observación sobre los talentos de nadie:
    // no se cuenta como "no lleva código" (regla 5).
    const talent =
      parts.specializations.status === 200
        ? findTalentLoadout(parts.specializations.data ?? {}, spec)
        : { code: null, talents: [], heroTree: null };
    if (talent.code !== null) report.withTalentCode++;
    if (talent.talents.length > 0) report.withTalentNodes++;

    // Aparte del loadout: los talentos PvP cuelgan de la spec, y que falten no
    // dice nada del loadout ni al revés (ADR 0026). Denominador propio, por eso
    // también contador propio.
    const pvpTalents =
      parts.specializations.status === 200
        ? mapPvpTalents(parts.specializations.data ?? {}, spec)
        : null;
    if (pvpTalents !== null) report.withPvpTalents++;

    const gear = mapEquipment(parts.equipment.data ?? {});
    report.gearRows += gear.length;

    const isNew = await saveProfileSnapshot(pool, {
      characterId: candidate.characterId,
      capturedAt,
      seasonId: candidate.seasonId,
      bracket: state.bracket,
      spec,
      rating: stats.rating,
      stats,
      profile: parts.profile.data,
      talentCode: talent.code,
      talents: [...talent.talents, ...(pvpTalents ?? [])],
      heroTree: talent.heroTree,
      gear,
    });
    if (isNew) report.snapshots++;
  }

  await markCharactersVerified(pool, verified, capturedAt);
}

// --- Reporte ---

/** Pares que hoy podrían sostener una comparación, y los que la sostendrían tras la corrida. */
function coverage(states: readonly PairState[], plan: RunPlan): { now: number; after: number } {
  const planned = new Map(
    plan.pairs.map((pair) => [pairKey(pair.state.bracket, pair.state.segment.id), pair.profiles]),
  );

  let servibleNow = 0;
  let servibleAfter = 0;
  for (const state of states) {
    if (state.subjectsBelow === 0) continue;
    if (canShowComparison(state.fresh)) servibleNow++;
    const extra = planned.get(pairKey(state.bracket, state.segment.id)) ?? 0;
    if (canShowComparison(state.fresh + extra)) servibleAfter++;
  }
  return { now: servibleNow, after: servibleAfter };
}

function printPlan(plan: RunPlan, states: readonly PairState[], budget: number): void {
  const servible = coverage(states, plan);

  console.log("\n=== PLAN DE LA CORRIDA ===");
  console.log(
    `Presupuesto: ${budget} peticiones · plan: ${plan.requests} (${plan.profiles} perfiles a ` +
      `${REQUESTS_PER_PROFILE} cada uno) en ${plan.pairs.length} pares.`,
  );
  console.log(
    `${plan.icpProfiles} de esos perfiles sirven a sujetos del ICP ` +
      `(${ICP_RATING_RANGE.min}-${ICP_RATING_RANGE.max}), que se cubre entero antes que nada de fuera.`,
  );
  console.log(
    `Pares servibles (gear ≥ ${MIN_SAMPLE_MEDIUM} y con sujetos debajo): ` +
      `${servible.now} hoy → ${servible.after} si la corrida termina.`,
  );

  // En qué se va el presupuesto, y no solo cuánto: el orden de gasto es una
  // decisión de producto (a cuánta gente real alcanzan las mismas peticiones),
  // así que tiene que poder auditarse sin abrir la base de datos.
  for (const pair of plan.pairs.slice(0, PLAN_PREVIEW)) {
    const { state } = pair;
    console.log(
      `  ${parseShuffleBracket(state.bracket)?.label ?? state.bracket} ` +
        `${formatSegment(state.segment)}: ${state.fresh} → ${state.fresh + pair.profiles} ` +
        `(+${pair.profiles}) · ${state.subjectsBelow} sujetos debajo`,
    );
  }
  if (plan.pairs.length > PLAN_PREVIEW) {
    console.log(`  … y ${plan.pairs.length - PLAN_PREVIEW} pares más.`);
  }

  if (plan.servesNobody > 0) {
    console.log(
      `${plan.servesNobody} pares no se muestrean: no hay población en el segmento de debajo, ` +
        `así que su gear no serviría a ningún sujeto (ADR 0010, decisión 5).`,
    );
  }
  if (plan.shortOfPopulation > 0) {
    console.log(
      `${plan.shortOfPopulation} pares no llegan al suelo de ${MIN_SAMPLE_MEDIUM} ni bajándole el ` +
        `perfil a todo el mundo: no hay tanta gente activa. Es el hallazgo, no un fallo.`,
    );
  }
  if (plan.shortOfBudget > 0) {
    console.log(
      `⚠️  ${plan.shortOfBudget} pares se quedan sin llegar al suelo por presupuesto. ` +
        `Suben en la próxima corrida, o antes con --budget.`,
    );
  }
  console.log("");
}

function printArenaPlan(plan: ArenaPlan, budget: number): void {
  console.log("=== PLAN DE ARENA (ADR 0049) ===");
  console.log(
    `Cuota: ${budget} peticiones · plan: ${plan.requests} (${plan.profiles} perfiles) en ` +
      `${plan.pairs.length} pares, en censo. Lo que no gasta vuelve a Solo Shuffle.`,
  );
  for (const pair of plan.pairs) {
    const { state } = pair;
    console.log(
      `  ${state.bracket} ${formatSegment(state.segment)}: ${state.fresh} → ` +
        `${state.fresh + pair.profiles} (+${pair.profiles}) · ${state.subjectsBelow} sujetos debajo`,
    );
  }
  if (plan.pending > 0) {
    console.log(
      `${plan.pending} activos de arena siguen sin perfil fresco por la cuota. ` +
        `Suben en las próximas corridas, o antes con --arena-share.`,
    );
  }
  if (plan.servesNobody > 0) {
    console.log(`${plan.servesNobody} pares de arena no se muestrean: nadie debajo.`);
  }
  console.log("");
}

function printReport(report: RunReport, plan: RunPlan): void {
  console.log("\n=== INGESTA CONTINUA DE PERFILES ===");
  console.log(
    `${report.profiles}/${plan.profiles} perfiles bajados · ${report.snapshots} snapshots nuevos · ` +
      `${report.gearRows} filas de gear.`,
  );
  console.log(
    `Talentos: ${report.withTalentCode} con código · ${report.withTalentNodes} con nodos · ` +
      `${report.withPvpTalents} con talentos PvP.`,
  );
  if (report.noRating > 0) {
    console.log(`${report.noRating} ya no aparecen en su bracket (rotación).`);
  }
  if (report.noSpec > 0) {
    console.log(`${report.noSpec} de arena sin spec activa reconocible: no se guardan (ADR 0048).`);
  }
  if (report.movedSegment > 0) {
    console.log(
      `${report.movedSegment} han cambiado de segmento desde el leaderboard que los eligió: ` +
        `su gear cuenta en el segmento nuevo, no en el que se planificó.`,
    );
  }
  if (report.apiErrors > 0) {
    console.log(`⚠️  ${report.apiErrors} perfiles con alguna respuesta distinta de 200.`);
  }
}

// --- Job ---

export async function refreshProfiles(args: string[] = []): Promise<void> {
  const options = parseOptions(args, getProfileRefreshBudget(), getProfileRefreshArenaShare());
  // Con `--specs` la corrida es de Solo Shuffle: la arena no nombra spec.
  const arenaBrackets = options.specs ? [] : getArenaBrackets();
  const region = getRegion();
  const now = new Date();

  // La configuración se valida antes de tocar nada: sin credenciales el job no
  // puede hacer su trabajo, y descubrirlo tras cargar la población es tarde.
  if (!options.dryRun) getBlizzardCredentials();
  getDatabaseUrl();

  // Se carga con la ventana más ancha que puede elegir un par y se recorta
  // después por par: una consulta, no una por ventana.
  const widest = options.window ?? ACTIVITY_WINDOWS.fallback;
  const cutoff = new Date(now.getTime() - widest * MS_PER_DAY);

  console.log("Ingesta continua de perfiles por segmento (issue #66, ADR 0010)\n");
  console.log(
    `Región ${region.toUpperCase()} · ventana ${
      options.window === null ? `hasta ${widest}d (elegida por par)` : `${widest}d (forzada)`
    } · objetivo ${MIN_SAMPLE_HIGH} por par, suelo ${MIN_SAMPLE_MEDIUM}`,
  );

  const pool = createPool();
  try {
    const { seasonId, seasons } = await resolveSeason(pool, region, cutoff);
    if (seasons.length > 1) {
      console.log(
        `⚠️  Hay snapshots de ${seasons.length} temporadas en la ventana (${seasons.join(", ")}). ` +
          `Se muestrea solo la ${seasonId}: el gear de la anterior no rellena el hueco del ` +
          `arranque de temporada (ADR 0010, decisión 6).`,
      );
    }
    console.log(`Temporada ${seasonId}.\n`);

    // La actividad se usa la que dejó el último agregado, de hace unas 22 horas
    // (ADR 0046). Recalcularla baja la serie caliente de cada bracket entera, y
    // hacerlo también aquí duplicaba la mayor salida diaria de Supabase. Lo que
    // cuesta es poco: en el borde de una ventana de 7 a 14 días, quien volvió
    // ayer espera un día más a que le bajen el perfil.
    //
    // La excepción es una temporada sin ninguna fila, el estado normal al
    // empezar: sin actividad no hay candidatos, y la corrida no haría nada sin
    // que nada lo explicara (ADR 0021, punto 8).
    const { rows: known } = await pool.query<{ exists: boolean }>(
      "select exists (select 1 from character_activity where season_id = $1) as exists",
      [seasonId],
    );
    if (!known[0]?.exists) {
      console.log("Sin actividad calculada para esta temporada; se calcula ahora (§27, #16):");
      printActivitySummary(
        await rebuildActivity(pool, region, seasonId, now, { dryRun: options.dryRun }),
      );
      console.log("");
    }

    const all = await loadCandidates(pool, region, seasonId, cutoff, arenaBrackets);
    const brackets = options.specs ? new Set(options.specs.map(shuffleBracketId)) : null;
    const candidates = brackets ? all.filter((row) => brackets.has(row.bracket)) : all;

    const entries = options.segmentEntries;
    const segments = entries
      ? new Set(entries.map((rating) => segmentFor(rating, DEFAULT_SEGMENT_SCALE).id))
      : null;
    const states = buildPairs(candidates, now, options.window).filter(
      (state) => segments === null || segments.has(state.segment.id),
    );

    console.log(
      `Población activa: ${candidates.length} personajes en ${states.length} pares (bracket, segmento).`,
    );

    const { shuffle: plan, arena } = planProfiles(states, options.budget, options.arenaShare);
    printPlan(
      plan,
      states.filter((state) => !isArenaBracket(state.bracket)),
      options.budget - arena.requests,
    );
    if (arenaBrackets.length > 0) {
      printArenaPlan(arena, Math.floor(options.budget * options.arenaShare));
    }

    if (options.dryRun) {
      console.log("--dry-run: no se ha llamado a Blizzard ni se ha escrito nada.");
      return;
    }
    if (plan.pairs.length === 0 && arena.pairs.length === 0) {
      console.log("Nada que bajar: todos los pares con sujetos debajo están al día.");
      return;
    }

    // La prioridad más baja de §28: esto alimenta los agregados de población,
    // que se recomputan sin que nadie espere delante. Es justo el trabajo que
    // debe ceder el turno a la búsqueda de un usuario.
    const client = new BlizzardClient({ priority: "aggregate", db: pool });
    // Uno para toda la corrida, como el sampledAt del muestreo manual.
    const capturedAt = now.toISOString();
    const report: RunReport = {
      profiles: 0,
      snapshots: 0,
      gearRows: 0,
      withTalentCode: 0,
      withTalentNodes: 0,
      withPvpTalents: 0,
      noRating: 0,
      noSpec: 0,
      apiErrors: 0,
      movedSegment: 0,
    };

    for (const planned of plan.pairs) {
      const spec = parseShuffleBracket(planned.state.bracket);
      if (!spec) {
        // Un bracket que el catálogo no sabe mapear no se salta en silencio: es
        // lo que escondió a shuffle-demonhunter-devourer (§9 de findings).
        console.log(
          `⚠️  ${planned.state.bracket} no está en ALL_SPECS: no se muestrea. ` +
            `Revisa el catálogo de packages/core.`,
        );
        continue;
      }
      await refreshPair(client, pool, planned, spec, capturedAt, options.seed, report);
    }
    // La arena va detrás: si la corrida se corta, lo que se pierde es lo que
    // todavía no sostiene ninguna pantalla.
    for (const planned of arena.pairs) {
      await refreshPair(client, pool, planned, null, capturedAt, options.seed, report);
    }

    printReport(report, { ...plan, profiles: plan.profiles + arena.profiles });
    console.log(`\nCuota: ${formatUsage(blizzardUsage())}`);
    console.log(
      `Los agregados no se recalculan aquí: lo hace el job diario (refresh-aggregates), que es ` +
        `quien convierte estos perfiles en adoption_rate.`,
    );
  } finally {
    await pool.end();
  }
}
