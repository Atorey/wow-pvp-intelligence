import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import {
  DEFAULT_SEGMENT_SCALE,
  canShowComparison,
  confidenceFor,
  formatSegment,
  segmentFor,
  shuffleBracketId,
  type ConfidenceLevel,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import { BlizzardClient, blizzardUsage } from "../blizzard/client";
import { formatUsage } from "../blizzard/request-queue";
import {
  PROFILES_DIR,
  REPORTS_DIR,
  getBlizzardCredentials,
  getDatabaseUrl,
  getRegion,
} from "../config";
import { createPool } from "../db/pool";
import { takeSample } from "../sampling";
import { SPECS_TO_INGEST } from "../specs-to-ingest";
import {
  findTalentLoadout,
  mapEquipment,
  type EquipmentResponse,
  type GearRow,
  type ProfileResponse,
  type PvpBracketResponse,
  type SpecializationsResponse,
  type TalentOutcome,
  type TalentResult,
} from "./profile-mapping";

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

/** Respuesta cruda tal cual se vuelca a disco, para poder reprocesar sin volver a llamar. */
interface Captured<T> {
  status: number;
  data: T | null;
}

interface ProfileCapture {
  realmSlug: string;
  nameSlug: string;
  bracket: string;
  fetchedAt: string;
  profile: Captured<ProfileResponse>;
  bracketStats: Captured<PvpBracketResponse>;
  equipment: Captured<EquipmentResponse>;
  specializations: Captured<SpecializationsResponse>;
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

function parseOptions(args: string[]): Options {
  const options: Options = {
    limit: DEFAULT_LIMIT,
    seed: DEFAULT_SEED,
    runId: null,
    segmentEntries: [...DEFAULT_SEGMENT_ENTRIES],
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
          `Opción desconocida: ${flag}. Disponibles: --limit, --seed, --run, --segments.`,
        );
    }
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

  const base = `/profile/wow/character/${encodeURIComponent(candidate.realmSlug)}/${encodeURIComponent(candidate.nameSlug)}`;

  // Cuatro llamadas, secuenciales y todas por BlizzardClient (regla 4): el
  // throttling es global, lanzarlas en paralelo no las haría más rápidas.
  //
  // El bracket de shuffle ya lo conocemos por la spec ingerida, así que se pide
  // directo en vez de pasar por pvp-summary como hace validate-endpoints (que
  // sí tiene que descubrir qué brackets juega un personaje cualquiera).
  const profile = await client.tryGet<ProfileResponse>(base, "profile");
  const bracketStats = await client.tryGet<PvpBracketResponse>(
    `${base}/pvp-bracket/${bracket}`,
    "profile",
  );
  const equipment = await client.tryGet<EquipmentResponse>(`${base}/equipment`, "profile");
  const specializations = await client.tryGet<SpecializationsResponse>(
    `${base}/specializations`,
    "profile",
  );

  const capture: ProfileCapture = {
    realmSlug: candidate.realmSlug,
    nameSlug: candidate.nameSlug,
    bracket,
    fetchedAt: new Date().toISOString(),
    profile: { status: profile.status, data: profile.data },
    bracketStats: { status: bracketStats.status, data: bracketStats.data },
    equipment: { status: equipment.status, data: equipment.data },
    specializations: { status: specializations.status, data: specializations.data },
  };

  fs.writeFileSync(file, JSON.stringify(capture, null, 2));
  return capture;
}

// --- Inserción ---

/**
 * Inserta el snapshot de perfil y su gear. Siempre INSERT, nunca UPDATE
 * (append-only, ADR 0002): un update sobre rating/gear/talentos destruiría el
 * histórico, que es el moat del producto.
 *
 * Devuelve false si el snapshot ya existía (reanudación o reejecución del run).
 */
async function insertSnapshot(
  pool: pg.Pool,
  manifest: RunManifest,
  candidate: Candidate,
  spec: SpecEntry,
  bracket: string,
  stats: PvpBracketResponse,
  profile: ProfileResponse | null,
  talentCode: string | null,
  gear: GearRow[],
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const inserted = await client.query<{ id: string }>(
      `insert into character_snapshots
         (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
          rating, matches_played, matches_won, matches_lost, pvp_tier_id,
          average_item_level, equipped_item_level, talent_loadout_code)
       values ($1, $2, 'profile', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       on conflict (character_id, bracket, captured_at) do nothing
       returning id`,
      [
        candidate.characterId,
        manifest.sampledAt,
        candidate.seasonId,
        bracket,
        spec.classSlug,
        spec.specSlug,
        stats.rating,
        // ladder_rank se queda a null: el perfil no da posición de ladder, y
        // copiarla del snapshot de leaderboard mezclaría fuentes.
        stats.season_match_statistics?.played ?? null,
        stats.season_match_statistics?.won ?? null,
        stats.season_match_statistics?.lost ?? null,
        stats.tier?.id ?? null,
        profile?.average_item_level ?? null,
        profile?.equipped_item_level ?? null,
        talentCode,
      ],
    );

    const isNew = (inserted.rowCount ?? 0) > 0;

    // Si el snapshot ya existía, puede ser de un run anterior que murió entre el
    // snapshot y su gear. Se recupera el id para completarlo en vez de dejarlo
    // a medias.
    let snapshotId = inserted.rows[0]?.id;
    if (!snapshotId) {
      const existing = await client.query<{ id: string }>(
        `select id from character_snapshots
          where character_id = $1 and bracket = $2 and captured_at = $3`,
        [candidate.characterId, bracket, manifest.sampledAt],
      );
      snapshotId = existing.rows[0]?.id;
    }

    // Una fila por slot, no un unnest en bloque: enchantment_ids, gem_item_ids y
    // bonus_list son int[], y unnest sobre un array de arrays los aplanaría en
    // una sola dimensión, mezclando las gemas de un item con las del siguiente.
    // Son ~16 slots por personaje dentro de la misma transacción.
    for (const item of snapshotId ? gear : []) {
      await client.query(
        `insert into character_snapshot_gear
           (snapshot_id, slot, item_id, item_name, item_level, quality,
            enchantment_ids, gem_item_ids, bonus_list)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         on conflict (snapshot_id, slot) do nothing`,
        [
          snapshotId,
          item.slot,
          item.itemId,
          item.itemName,
          item.itemLevel,
          item.quality,
          item.enchantmentIds,
          item.gemItemIds,
          item.bonusList,
        ],
      );
    }

    await client.query("commit");
    return isNew;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
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
        : { code: null, outcome: "api-error" };
    report.talents[talent.outcome]++;

    const gear = mapEquipment(capture.equipment.data ?? {});
    report.gearRows += gear.length;
    if (typeof capture.profile.data?.average_item_level === "number") report.itemLevelAvailable++;

    const isNew = await insertSnapshot(
      pool,
      manifest,
      candidate,
      spec,
      bracket,
      stats,
      capture.profile.data,
      talent.code,
      gear,
    );
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
        `${r.talents["api-error"]} sin respuesta`,
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

  const brackets = SPECS_TO_INGEST.map(shuffleBracketId);
  const manifest = loadOrCreateManifest(options, region, brackets);
  const runDir = path.join(PROFILES_DIR, manifest.runId);
  fs.mkdirSync(runDir, { recursive: true });

  const segments = manifest.segmentEntries.map((rating) =>
    segmentFor(rating, DEFAULT_SEGMENT_SCALE),
  );
  const buckets = SPECS_TO_INGEST.length * segments.length;

  console.log(`Run: ${manifest.runId} (región ${region.toUpperCase()})`);
  console.log(`captured_at de todos los snapshots: ${manifest.sampledAt}`);
  console.log(
    `Tope por bucket: ${manifest.limit > 0 ? manifest.limit : "sin tope (censo)"} · semilla: "${manifest.seed}"`,
  );
  console.log(
    `Segmentos: ${segments.map(formatSegment).join(", ")} · specs: ${SPECS_TO_INGEST.length}`,
  );
  console.log(
    manifest.limit > 0
      ? `Coste máximo: ${buckets * manifest.limit * 4} peticiones (4 por personaje).\n`
      : `Censo: el coste depende de la población de cada bucket (4 peticiones por personaje).\n`,
  );

  // La prioridad más baja de §28: esto alimenta los agregados de población, que
  // se recomputan sin que nadie espere delante. Un censo son decenas de miles de
  // peticiones, así que es justo el trabajo que debe ceder el turno a lo demás.
  const client = new BlizzardClient({ priority: "aggregate" });
  const pool = createPool();
  const reports: BucketReport[] = [];

  try {
    for (const spec of SPECS_TO_INGEST) {
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
