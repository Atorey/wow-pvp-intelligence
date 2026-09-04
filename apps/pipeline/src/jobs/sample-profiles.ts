import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import {
  DEFAULT_SEGMENT_SCALE,
  canShowComparison,
  confidenceFor,
  formatSegment,
  parseShuffleBracket,
  requireSpecSlug,
  segmentFor,
  shuffleBracketId,
  type ConfidenceLevel,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import {
  BlizzardClient,
  blizzardUsage,
  findTalentLoadout,
  formatUsage,
  mapEquipment,
  mapPvpTalents,
  type TalentOutcome,
  type TalentResult,
} from "@wowpvp/blizzard";
import {
  PROFILES_DIR,
  REPORTS_DIR,
  getBlizzardCredentials,
  getDatabaseUrl,
  getRegion,
  getRequestsPerHour,
} from "../config";
import { createPool } from "../db/pool";
import { takeSample } from "../sampling";
import { SPECS_TO_INGEST } from "../specs-to-ingest";
import {
  REQUESTS_PER_PROFILE,
  fetchProfileParts,
  saveProfileSnapshot,
  type ProfileParts,
} from "./profile-capture";

/**
 * Muestreo de perfiles completos (issue #8).
 *
 * El leaderboard solo trae rating; Player Gap compara gear y talentos. Este job
 * coge una muestra de cada segmento de rating y baja el perfil completo de esos
 * personajes: es lo que convierte "hay 3.000 jugadores en 1800-2000" en "el X%
 * del siguiente segmento lleva este item".
 *
 * Cuesta 4 peticiones por personaje, así que está pensado para ejecutarse a mano
 * y poder reanudarse (ver RunManifest).
 */

/** Rating de entrada de los segmentos que se muestrean por defecto (§27: 1800-2000 y 2000-2200). */
const DEFAULT_SEGMENT_ENTRIES = [1800, 2000];

/** Personajes por bucket. 100 es el umbral de confianza "high" (§13.4). */
const DEFAULT_LIMIT = 100;

/**
 * Semilla por defecto constante, no aleatoria: dos ejecuciones distintas
 * muestrean a los mismos personajes, así que el histórico de un bucket sigue a
 * la misma cohorte en vez de a una muestra nueva cada vez.
 */
const DEFAULT_SEED = "sample-profiles";

/** Cada cuántos personajes se imprime progreso (un censo son miles de líneas si no). */
const PROGRESS_EVERY = 25;

interface Options {
  limit: number;
  seed: string;
  runId: string | null;
  segmentEntries: number[];
  /** Specs de este run. `null` = las que ingiere el pipeline (ver --specs). */
  specs: SpecEntry[] | null;
}

/**
 * El manifiesto fija los parámetros del run, y sobre todo `sampledAt`: es el
 * captured_at de todos los snapshots del run, igual que `fetchedAt` en
 * fetch-leaderboard. Estable aunque el run se reanude horas después, para que
 * reinsertar choque contra idx_snapshots_unique_capture y no duplique población
 * — duplicarla inflaría los tamaños de muestra y con ellos la confianza que
 * declaramos, justo lo que el producto promete no hacer.
 */
interface RunManifest {
  runId: string;
  sampledAt: string;
  region: string;
  seed: string;
  limit: number;
  /** Rating de entrada de cada segmento; los límites los pone segmentFor(), no el manifiesto. */
  segmentEntries: number[];
  brackets: string[];
}

interface Candidate {
  characterId: string;
  realmSlug: string;
  nameSlug: string;
  nameDisplay: string;
  seasonId: number;
}

/** Lo que se vuelca a disco: las cuatro respuestas crudas y de quién son. */
interface ProfileCapture extends ProfileParts {
  realmSlug: string;
  nameSlug: string;
  bracket: string;
  fetchedAt: string;
}

interface BucketReport {
  spec: string;
  bracket: string;
  classSlug: string;
  segment: string;
  candidates: number;
  sampled: number;
  snapshots: number;
  confidence: ConfidenceLevel;
  canCompare: boolean;
  talents: Record<TalentOutcome, number>;
  /** Perfiles con nodos y con talentos PvP: denominadores propios (ADR 0026). */
  talentNodes: number;
  pvpTalents: number;
  gearRows: number;
  itemLevelAvailable: number;
  failures: {
    noRating: number;
    profileError: number;
    equipmentError: number;
    specializationsError: number;
  };
}

// --- Argumentos ---

/**
 * Specs de --specs, resueltas contra el catálogo por su slug canónico.
 *
 * El slug entero se compara contra el catálogo, nunca se parte por guiones:
 * "beast-mastery-hunter" daría spec "beast" y clase "mastery-hunter". Un slug
 * que no exista rompe aquí, antes de gastar cuota, en vez de muestrear en
 * silencio menos specs de las que creías.
 */
export function parseSpecSelection(value: string): SpecEntry[] {
  const slugs = value
    .split(",")
    .map((k) => k.trim())
    .filter((k) => k.length > 0);
  if (slugs.length === 0) {
    throw new Error(`--specs="${value}" no nombra ninguna spec. Ejemplo: frost-mage,fury-warrior.`);
  }

  // requireSpecSlug ya explica la forma del slug y dónde está el catálogo: el
  // mensaje se escribe una sola vez, donde se define el formato.
  return slugs.map(requireSpecSlug);
}

/**
 * Specs de un run, leídas del manifiesto y no de SPECS_TO_INGEST.
 *
 * Es lo que hace que reanudar un run sea reanudarlo: la lista activa del
 * pipeline crece (#13 la llevó de 3 a 40 specs), y un --run que iterase sobre la
 * constante viva se pondría a muestrear specs nuevas bajo el `sampledAt` del run
 * viejo — población de agosto y de octubre con el mismo captured_at.
 */
export function specsFromManifest(manifest: RunManifest): SpecEntry[] {
  return manifest.brackets.map((bracket) => {
    const spec = parseShuffleBracket(bracket);
    if (!spec) {
      throw new Error(
        `El run "${manifest.runId}" incluye el bracket "${bracket}", que ya no está en ` +
          `ALL_SPECS. No se puede reanudar sin saber a qué spec corresponde.`,
      );
    }
    return spec;
  });
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    limit: DEFAULT_LIMIT,
    seed: DEFAULT_SEED,
    runId: null,
    segmentEntries: [...DEFAULT_SEGMENT_ENTRIES],
    specs: null,
  };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    const value = args[i + 1];
    if (!flag?.startsWith("--")) continue;
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`La opción ${flag} necesita un valor.`);
    }
    i++;

    switch (flag) {
      case "--limit": {
        const parsed = Number(value);
        if (!Number.isInteger(parsed)) {
          throw new Error(`--limit="${value}" no es un entero. Usa 0 para censo completo.`);
        }
        options.limit = parsed;
        break;
      }
      case "--seed":
        options.seed = value;
        break;
      case "--run":
        options.runId = value;
        break;
      case "--specs":
        options.specs = parseSpecSelection(value);
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
          `Opción desconocida: ${flag}. Disponibles: --limit, --seed, --run, --segments, --specs.`,
        );
    }
  }

  if (options.runId && options.specs) {
    throw new Error(
      "--specs no se combina con --run: las specs de un run son parte del run y se leen " +
        "de su manifiesto. Lanza un run nuevo si quieres otra selección.",
    );
  }

  return options;
}

// --- Manifiesto ---

function loadOrCreateManifest(options: Options, region: string, brackets: string[]): RunManifest {
  if (options.runId) {
    const file = path.join(PROFILES_DIR, options.runId, "manifest.json");
    if (!fs.existsSync(file)) {
      throw new Error(`No existe el run "${options.runId}" (falta ${file}).`);
    }
    // Se reusan los parámetros del run original: reanudar con otra semilla u
    // otro límite daría una muestra distinta bajo el mismo captured_at.
    return JSON.parse(fs.readFileSync(file, "utf-8")) as RunManifest;
  }

  const sampledAt = new Date().toISOString();
  const stamp = sampledAt.replace(/[-:]/g, "").replace(/\..+$/, "");
  const manifest: RunManifest = {
    runId: `run-${stamp}`,
    sampledAt,
    region,
    seed: options.seed,
    limit: options.limit,
    segmentEntries: options.segmentEntries,
    brackets,
  };

  fs.mkdirSync(path.join(PROFILES_DIR, manifest.runId), { recursive: true });
  fs.writeFileSync(
    path.join(PROFILES_DIR, manifest.runId, "manifest.json"),
    JSON.stringify(manifest, null, 2),
  );
  return manifest;
}

// --- Selección de candidatos ---

/**
 * Población elegible de un bucket, leída de la vista de "último snapshot por
 * personaje y bracket" y nunca de character_snapshots a pelo: contar snapshots
 * contaría dos veces al mismo jugador tras la segunda ingesta.
 *
 * El orden por character_id es estable a propósito — la aleatoriedad la pone
 * takeSample con la semilla, no el planificador de Postgres.
 */
async function findCandidates(
  pool: pg.Pool,
  region: string,
  bracket: string,
  segment: RatingSegment,
): Promise<Candidate[]> {
  const { rows } = await pool.query<{
    character_id: string;
    realm_slug: string;
    name_slug: string;
    name_display: string;
    season_id: number;
  }>(
    `select l.character_id, c.realm_slug, c.name_slug, c.name_display, l.season_id
       from latest_snapshot_per_character_bracket l
       join characters c on c.id = l.character_id
      where c.region = $1 and l.bracket = $2 and l.rating >= $3 and l.rating < $4
      order by l.character_id`,
    // El tramo es semiabierto [min, max); el de arriba es abierto, así que se
    // acota con un techo imposible en vez de fingir un máximo real.
    [region, bracket, segment.min, Number.isFinite(segment.max) ? segment.max : 1_000_000],
  );

  return rows.map((r) => ({
    characterId: r.character_id,
    realmSlug: r.realm_slug,
    nameSlug: r.name_slug,
    nameDisplay: r.name_display,
    seasonId: r.season_id,
  }));
}

/** La muestra elegida para un bucket, congelada en disco como parte del run. */
interface BucketSample {
  bracket: string;
  segment: string;
  /** Población del bucket en el momento de elegir la muestra. */
  candidates: number;
  sample: Candidate[];
}

/**
 * Muestra de un bucket, calculada una sola vez y congelada en el run.
 *
 * No basta con que takeSample sea determinista: este job escribe snapshots de
 * perfil, y el rating del perfil puede diferir del que traía el leaderboard, así
 * que un personaje puede cambiar de segmento y salir del bucket. La población
 * cambia bajo los pies del propio job, y recalcular la muestra en una
 * reanudación daría personajes distintos — volviendo a gastar cuota y rompiendo
 * la promesa de que la misma semilla da la misma muestra.
 *
 * La muestra es un hecho del run, igual que sampledAt: se decide al principio y
 * no se vuelve a tocar.
 */
async function resolveSample(
  pool: pg.Pool,
  manifest: RunManifest,
  runDir: string,
  bracket: string,
  segment: RatingSegment,
): Promise<BucketSample> {
  const file = path.join(runDir, `sample-${bracket}-${segment.id}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as BucketSample;
  }

  const candidates = await findCandidates(pool, manifest.region, bracket, segment);
  const chosen: BucketSample = {
    bracket,
    segment: formatSegment(segment),
    candidates: candidates.length,
    sample: takeSample(candidates, manifest.limit, `${manifest.seed}|${bracket}|${segment.id}`),
  };

  fs.writeFileSync(file, JSON.stringify(chosen, null, 2));
  return chosen;
}

// --- Descarga ---

/**
 * Baja el perfil completo de un personaje, o lo lee del disco si este run ya lo
 * bajó. Ese archivo es a la vez el volcado del crudo y el mecanismo de
 * reanudación: un run cortado no vuelve a gastar cuota en lo que ya tenía.
 */
async function captureProfile(
  client: BlizzardClient,
  runDir: string,
  candidate: Candidate,
  bracket: string,
): Promise<ProfileCapture> {
  const file = path.join(runDir, `${candidate.realmSlug}-${candidate.nameSlug}.json`);
  if (fs.existsSync(file)) {
    return JSON.parse(fs.readFileSync(file, "utf-8")) as ProfileCapture;
  }

  const parts = await fetchProfileParts(client, {
    realmSlug: candidate.realmSlug,
    nameSlug: candidate.nameSlug,
    bracket,
  });

  const capture: ProfileCapture = {
    realmSlug: candidate.realmSlug,
    nameSlug: candidate.nameSlug,
    bracket,
    fetchedAt: new Date().toISOString(),
    ...parts,
  };

  fs.writeFileSync(file, JSON.stringify(capture, null, 2));
  return capture;
}

// --- Orquestación de un bucket ---

async function sampleBucket(
  client: BlizzardClient,
  pool: pg.Pool,
  manifest: RunManifest,
  runDir: string,
  spec: SpecEntry,
  segment: RatingSegment,
): Promise<BucketReport> {
  const bracket = shuffleBracketId(spec);
  const { candidates, sample } = await resolveSample(pool, manifest, runDir, bracket, segment);

  const report: BucketReport = {
    spec: spec.label,
    bracket,
    classSlug: spec.classSlug,
    segment: formatSegment(segment),
    candidates,
    sampled: sample.length,
    snapshots: 0,
    confidence: "insufficient",
    canCompare: false,
    talents: { ok: 0, "spec-not-listed": 0, "no-loadout": 0, "no-code": 0, "api-error": 0 },
    talentNodes: 0,
    pvpTalents: 0,
    gearRows: 0,
    itemLevelAvailable: 0,
    failures: { noRating: 0, profileError: 0, equipmentError: 0, specializationsError: 0 },
  };

  console.log(
    `→ ${spec.label} ${formatSegment(segment)}: ${candidates} candidatos, ` +
      `muestreando ${sample.length}...`,
  );

  // Un bucket más corto que el tope no es un fallo del job: es el hallazgo de
  // #6 (el top 5.000 deja fuera el rango bajo del ICP en las specs más jugadas).
  // Se muestrea lo que haya y se declara el n real; nunca se rellena bajando.
  if (manifest.limit > 0 && candidates < manifest.limit) {
    console.log(`   ⚠️  El bucket no llega al tope de ${manifest.limit}: solo hay ${candidates}.`);
  }

  let done = 0;
  for (const candidate of sample) {
    const capture = await captureProfile(client, runDir, candidate, bracket);
    done++;
    if (done % PROGRESS_EVERY === 0) console.log(`   ${done}/${sample.length}`);

    if (capture.profile.status !== 200) report.failures.profileError++;
    if (capture.equipment.status !== 200) report.failures.equipmentError++;
    if (capture.specializations.status !== 200) report.failures.specializationsError++;

    // Sin rating no hay snapshot que insertar (la columna es not null). Suele
    // significar que el personaje ya no juega este bracket: es rotación, un dato
    // más, no un error que haya que ocultar.
    const stats = capture.bracketStats.data;
    if (typeof stats?.rating !== "number") {
      report.failures.noRating++;
      continue;
    }

    // Un fallo del endpoint no es una observación sobre los talentos del
    // personaje: se cuenta aparte para que no ensucie la cobertura por clase.
    const talent: TalentResult =
      capture.specializations.status === 200
        ? findTalentLoadout(capture.specializations.data ?? {}, spec)
        : { code: null, outcome: "api-error", talents: [], heroTree: null };
    report.talents[talent.outcome]++;
    if (talent.talents.length > 0) report.talentNodes++;

    const pvpTalents =
      capture.specializations.status === 200
        ? mapPvpTalents(capture.specializations.data ?? {}, spec)
        : null;
    if (pvpTalents !== null) report.pvpTalents++;

    const gear = mapEquipment(capture.equipment.data ?? {});
    report.gearRows += gear.length;
    if (typeof capture.profile.data?.average_item_level === "number") report.itemLevelAvailable++;

    const isNew = await saveProfileSnapshot(pool, {
      characterId: candidate.characterId,
      capturedAt: manifest.sampledAt,
      seasonId: candidate.seasonId,
      bracket,
      spec,
      rating: stats.rating,
      stats,
      profile: capture.profile.data,
      talentCode: talent.code,
      talents: [...talent.talents, ...(pvpTalents ?? [])],
      heroTree: talent.heroTree,
      gear,
    });
    if (isNew) report.snapshots++;
  }

  // El tamaño de muestra real es el de perfiles utilizables, no el de intentos:
  // declarar confianza sobre los que fallaron sería inflarla.
  const usable = sample.length - report.failures.noRating;
  report.confidence = confidenceFor(usable);
  report.canCompare = canShowComparison(usable);

  return report;
}

// --- Reporte ---

function printReport(reports: BucketReport[]): void {
  console.log("\n=== MUESTREO DE PERFILES POR SEGMENTO ===");
  console.log("(confianza según §13.4: high n≥100, medium n≥30, por debajo no se compara)\n");

  for (const r of reports) {
    const usable = r.sampled - r.failures.noRating;
    console.log(`${r.canCompare ? "✅" : "⚠️"} ${r.spec} ${r.segment}`);
    console.log(
      `   Candidatos: ${r.candidates} · muestreados: ${r.sampled} · utilizables: ${usable} (${r.confidence})`,
    );
    console.log(`   Snapshots nuevos: ${r.snapshots} · filas de gear: ${r.gearRows}`);
    console.log(
      `   Talentos: ${r.talents.ok} con código · ${r.talents["no-code"]} sin código · ` +
        `${r.talents["spec-not-listed"]} spec no listada · ${r.talents["no-loadout"]} sin loadout · ` +
        `${r.talents["api-error"]} sin respuesta · ${r.talentNodes} con nodos · ` +
        `${r.pvpTalents} con talentos PvP`,
    );
    if (r.failures.noRating > 0) {
      console.log(`   ${r.failures.noRating} ya no aparecen en el bracket (rotación).`);
    }
    const apiErrors =
      r.failures.profileError + r.failures.equipmentError + r.failures.specializationsError;
    if (apiErrors > 0) {
      console.log(
        `   ⚠️  Errores de API — perfil: ${r.failures.profileError}, equipo: ${r.failures.equipmentError}, ` +
          `talentos: ${r.failures.specializationsError}`,
      );
    }
    if (!r.canCompare) {
      console.log(`   ⚠️  Por debajo del mínimo: este bucket no puede sostener una comparación.`);
    }
    console.log("");
  }

  // Cobertura de talentos por clase: es lo que decide el GO/NO-GO de §32, no el
  // porcentaje global. El bug del parche 11.2 no afectaba a todas las clases
  // por igual, así que un agregado bueno puede esconder una clase rota.
  console.log("=== COBERTURA DE TALENTOS POR CLASE ===");
  const byClass = new Map<string, { withCode: number; total: number }>();
  for (const r of reports) {
    const acc = byClass.get(r.classSlug) ?? { withCode: 0, total: 0 };
    acc.withCode += r.talents.ok;
    acc.total += r.talents.ok + r.talents["no-code"] + r.talents["no-loadout"];
    byClass.set(r.classSlug, acc);
  }
  for (const [classSlug, { withCode, total }] of [...byClass].sort()) {
    const rate = total > 0 ? Math.round((withCode / total) * 100) : 0;
    console.log(
      `  ${withCode === total && total > 0 ? "✅" : "⚠️"} ${classSlug}: ${withCode}/${total} (${rate}%)`,
    );
  }
  console.log(`\nClases cubiertas por esta muestra: ${byClass.size}/13`);
  if (byClass.size < 13) {
    console.log(
      "⚠️  Muestra incompleta por clase: no da para comprometer talentos en Player Gap (§32).",
    );
  }
}

// --- Entrada ---

export async function sampleProfiles(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();

  // Se valida la configuración antes de crear nada en disco: si falta una
  // credencial, el intento fallido no debe dejar atrás una carpeta de run vacía
  // que luego parezca un run reanudable.
  getBlizzardCredentials();
  getDatabaseUrl();

  const brackets = (options.specs ?? SPECS_TO_INGEST).map(shuffleBracketId);
  const manifest = loadOrCreateManifest(options, region, brackets);
  const runDir = path.join(PROFILES_DIR, manifest.runId);
  fs.mkdirSync(runDir, { recursive: true });

  // Siempre del manifiesto, también en un run nuevo: una única forma de saber
  // qué specs lleva el run, en vez de dos que pueden divergir al reanudar.
  const specs = specsFromManifest(manifest);
  const segments = manifest.segmentEntries.map((rating) =>
    segmentFor(rating, DEFAULT_SEGMENT_SCALE),
  );
  const buckets = specs.length * segments.length;

  console.log(`Run: ${manifest.runId} (región ${region.toUpperCase()})`);
  console.log(`captured_at de todos los snapshots: ${manifest.sampledAt}`);
  console.log(
    `Tope por bucket: ${manifest.limit > 0 ? manifest.limit : "sin tope (censo)"} · semilla: "${manifest.seed}"`,
  );
  console.log(`Segmentos: ${segments.map(formatSegment).join(", ")} · specs: ${specs.length}`);

  if (manifest.limit > 0) {
    const cost = buckets * manifest.limit * REQUESTS_PER_PROFILE;
    console.log(`Coste máximo: ${cost} peticiones (4 por personaje).`);
    // Con las 40 specs del catálogo el muestreo por defecto se sale del techo
    // horario, y la cola se para una hora entera a mitad de run. Es recuperable
    // (el crudo ya bajado no se vuelve a pedir), pero conviene saberlo antes de
    // lanzarlo y no cuando lleva 40 minutos parado: para acotar está --specs.
    const perHour = getRequestsPerHour();
    if (cost > perHour) {
      console.log(
        `⚠️  Por encima del techo horario (${perHour}): la cola se parará a esperar cuota. ` +
          `Acota con --specs o --limit si quieres que quepa en una corrida.`,
      );
    }
    console.log("");
  } else {
    console.log(
      `Censo: el coste depende de la población de cada bucket (4 peticiones por personaje).\n`,
    );
  }

  // La prioridad más baja de §28: esto alimenta los agregados de población, que
  // se recomputan sin que nadie espere delante. Un censo son decenas de miles de
  // peticiones, así que es justo el trabajo que debe ceder el turno a lo demás.
  const pool = createPool();
  const client = new BlizzardClient({ priority: "aggregate", db: pool });
  const reports: BucketReport[] = [];

  try {
    for (const spec of specs) {
      for (const segment of segments) {
        reports.push(await sampleBucket(client, pool, manifest, runDir, spec, segment));
      }
    }
  } finally {
    await pool.end();
  }

  printReport(reports);

  fs.mkdirSync(REPORTS_DIR, { recursive: true });
  const out = path.join(REPORTS_DIR, `profile-sample-${manifest.runId}.json`);
  fs.writeFileSync(out, JSON.stringify({ manifest, buckets: reports }, null, 2));
  console.log(`\nCuota: ${formatUsage(blizzardUsage())}`);
  console.log(`Crudo: ${runDir}`);
  console.log(`Reporte detallado: ${out}`);
  console.log(`Para reanudar este run sin volver a gastar cuota:`);
  console.log(`  npm run pipeline -- sample-profiles --run ${manifest.runId}`);
}
