import type pg from "pg";
import { specKey, type SpecEntry } from "@wowpvp/core";
import { BlizzardClient, blizzardUsage } from "../blizzard/client";
import { formatUsage } from "../blizzard/request-queue";
import { getCharacterLookupTtlMinutes, getDatabaseUrl, getRegion } from "../config";
import { identityKey, upsertCharacters } from "../db/characters";
import { createPool } from "../db/pool";
import { insertProfileSnapshot } from "../db/snapshots";
import {
  activeSpecOf,
  formatCharacterRef,
  isProfileFresh,
  parseCharacterRef,
  shuffleBracketsFromSummary,
  type CharacterRef,
  type PvpSummaryResponse,
  type ShuffleBracketRef,
} from "./character-lookup";
import { resolveCurrentSeasonId } from "./fetch-leaderboard";
import {
  findTalentLoadout,
  mapEquipment,
  type EquipmentResponse,
  type GearRow,
  type ProfileResponse,
  type PvpBracketResponse,
  type SpecializationsResponse,
} from "./profile-mapping";

/**
 * Acumulación de población por búsqueda de usuario (issue #14, §6 y §12).
 *
 * El leaderboard solo expone el top 5.000 por spec, y en las specs más jugadas
 * ese corte cae por encima del ICP: Frost Mage no baja de ~1800, así que un
 * jugador de 1600 no está en nuestra base y no tiene con quién compararse. La
 * segunda vía de población del plan es esta — cada personaje que alguien
 * consulta entra al dataset, igual que hace Drustvar.
 *
 * Aquí está el motor. La búsqueda de la web (#19, Phase 2) importará
 * `lookupCharacter` tal cual: el comando CLI existe para poder ejercitarlo y
 * medirlo hoy, no como destino final.
 */

/**
 * Cómo acabó una búsqueda. Se guarda en la bitácora tal cual, así que estos son
 * también los valores que admite el check de character_lookups.
 */
export type LookupOutcome = "ok" | "cached" | "not-found" | "no-brackets" | "error";

export interface LookupResult {
  ref: CharacterRef;
  outcome: LookupOutcome;
  characterId: string | null;
  /** ¿No lo teníamos? Es la métrica que dice si esta feature aporta población. */
  newCharacter: boolean;
  bracketsFound: number;
  snapshotsInserted: number;
  gearRows: number;
  talentCodes: number;
  note: string | null;
}

export interface LookupDeps {
  pool: pg.Pool;
  client: BlizzardClient;
  region: string;
  ttlMinutes: number;
  /** Ignora la caché. Para depurar, no para uso normal: se salta el ahorro de cuota. */
  force: boolean;
  /** Inyectable para poder probar la caducidad de la caché sin esperar 30 minutos. */
  now?: () => Date;
}

/** Lo que sabemos de un personaje antes de preguntar a Blizzard. */
interface ExistingCharacter {
  id: string;
  /** Última captura de perfil (muestreo o búsqueda). null = solo lo hemos visto en leaderboard. */
  lastProfileAt: Date | null;
}

async function findExisting(
  pool: pg.Pool,
  region: string,
  ref: CharacterRef,
): Promise<ExistingCharacter | null> {
  // La frescura se mide sobre snapshots de perfil, no sobre los de leaderboard:
  // un snapshot de leaderboard trae rating y nada más, así que tenerlo reciente
  // no evita la llamada — seguirían faltando gear y talentos, que es a lo que
  // viene la búsqueda.
  const { rows } = await pool.query<{ id: string; last_profile_at: Date | null }>(
    `select c.id,
            max(s.captured_at) filter (where s.source in ('profile', 'search')) as last_profile_at
       from characters c
       left join character_snapshots s on s.character_id = c.id
      where c.region = $1 and c.realm_slug = $2 and c.name_slug = $3
      group by c.id`,
    [region, ref.realmSlug, ref.nameSlug],
  );

  const row = rows[0];
  return row ? { id: row.id, lastProfileAt: row.last_profile_at } : null;
}

async function recordLookup(
  pool: pg.Pool,
  region: string,
  requestedAt: string,
  result: LookupResult,
): Promise<void> {
  await pool.query(
    `insert into character_lookups
       (region, realm_slug, name_slug, requested_at, outcome, character_id,
        new_character, brackets_found, snapshots_inserted, note)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      region,
      result.ref.realmSlug,
      result.ref.nameSlug,
      requestedAt,
      result.outcome,
      result.characterId,
      result.newCharacter,
      result.bracketsFound,
      result.snapshotsInserted,
      result.note,
    ],
  );
}

/** Lo descargado de un personaje, antes de decidir qué se guarda. */
interface Capture {
  profile: ProfileResponse;
  brackets: { ref: ShuffleBracketRef; stats: PvpBracketResponse }[];
  gear: GearRow[];
  /** null = el endpoint de talentos no respondió; no es lo mismo que "sin talentos". */
  specializations: SpecializationsResponse | null;
}

interface CaptureOutcome {
  capture: Capture | null;
  outcome: LookupOutcome;
  /** Aviso de lo que no se pudo traer. null si respondió todo. */
  note: string | null;
}

/**
 * Baja el perfil completo del personaje: identidad, brackets de Solo Shuffle que
 * juega, gear y talentos.
 *
 * Cuesta 4 peticiones más una por bracket jugado. Los brackets no se adivinan:
 * salen del propio pvp-summary, así que un personaje que juega dos specs cuesta
 * 6 peticiones y no 44.
 */
async function captureCharacter(
  client: BlizzardClient,
  ref: CharacterRef,
): Promise<CaptureOutcome> {
  const base = `/profile/wow/character/${encodeURIComponent(ref.realmSlug)}/${encodeURIComponent(ref.nameSlug)}`;

  const profile = await client.tryGet<ProfileResponse>(base, "profile");
  if (profile.status === 404) {
    // "No existe" es una respuesta legítima a una búsqueda, no un fallo: quien
    // buscaba se equivocó de reino o de nombre. No se crea identidad ninguna.
    return { capture: null, outcome: "not-found", note: null };
  }
  if (!profile.ok || !profile.data) {
    return {
      capture: null,
      outcome: "error",
      note: `perfil: HTTP ${profile.status} — ${profile.error?.slice(0, 200) ?? "sin cuerpo"}`,
    };
  }

  const notes: string[] = [];

  const summary = await client.tryGet<PvpSummaryResponse>(`${base}/pvp-summary`, "profile");
  if (!summary.ok) {
    // El personaje existe: su identidad ya es población acumulada y sirve para
    // el autocompletado de la búsqueda (§21). Se guarda lo que sí sabemos y
    // queda constancia de que los brackets no se pudieron mirar — que es
    // distinto de "no juega ninguno".
    const note = `pvp-summary: HTTP ${summary.status}`;
    return {
      capture: { profile: profile.data, brackets: [], gear: [], specializations: null },
      outcome: "error",
      note,
    };
  }

  const bracketRefs = shuffleBracketsFromSummary(summary.data ?? {});
  if (bracketRefs.length === 0) {
    // Existe y no juega Solo Shuffle (o solo juega 2v2/3v3/RBG, que hoy no
    // modelamos). Su identidad entra igual; snapshots, ninguno.
    return {
      capture: { profile: profile.data, brackets: [], gear: [], specializations: null },
      outcome: "no-brackets",
      note: null,
    };
  }

  // Equipo y talentos se piden solo ahora: si el personaje no juega shuffle no
  // hay snapshot donde colgarlos y serían dos peticiones tiradas.
  const equipment = await client.tryGet<EquipmentResponse>(`${base}/equipment`, "profile");
  if (!equipment.ok) notes.push(`equipo: HTTP ${equipment.status}`);

  const specializations = await client.tryGet<SpecializationsResponse>(
    `${base}/specializations`,
    "profile",
  );
  if (!specializations.ok) notes.push(`talentos: HTTP ${specializations.status}`);

  const brackets: { ref: ShuffleBracketRef; stats: PvpBracketResponse }[] = [];
  for (const bracketRef of bracketRefs) {
    const stats = await client.tryGet<PvpBracketResponse>(bracketRef.path, "profile");
    if (!stats.ok || !stats.data) {
      notes.push(`${bracketRef.bracket}: HTTP ${stats.status}`);
      continue;
    }
    brackets.push({ ref: bracketRef, stats: stats.data });
  }

  return {
    capture: {
      profile: profile.data,
      brackets,
      gear: equipment.ok ? mapEquipment(equipment.data ?? {}) : [],
      specializations: specializations.ok ? (specializations.data ?? {}) : null,
    },
    outcome: "ok",
    note: notes.length > 0 ? notes.join(" · ") : null,
  };
}

/**
 * Temporada de un bracket. La trae la propia respuesta; el índice de temporadas
 * solo se consulta si no viniera, y una sola vez por proceso — `season_id` es
 * not null, y adivinarlo mal metería el snapshot en la temporada equivocada.
 */
function seasonResolver(client: BlizzardClient): (stats: PvpBracketResponse) => Promise<number> {
  let pending: Promise<number> | null = null;

  return async (stats) => {
    if (typeof stats.season?.id === "number") return stats.season.id;
    pending ??= resolveCurrentSeasonId(client);
    return pending;
  };
}

/**
 * Busca un personaje y lo incorpora a la población acumulada.
 *
 * Es la función que consumirá la web: recibe todo lo que necesita y no imprime
 * nada, para que quien llame decida qué enseñar.
 */
export async function lookupCharacter(deps: LookupDeps, ref: CharacterRef): Promise<LookupResult> {
  const now = deps.now?.() ?? new Date();
  const requestedAt = now.toISOString();

  const result: LookupResult = {
    ref,
    outcome: "error",
    characterId: null,
    newCharacter: false,
    bracketsFound: 0,
    snapshotsInserted: 0,
    gearRows: 0,
    talentCodes: 0,
    note: null,
  };

  const existing = await findExisting(deps.pool, deps.region, ref);
  result.characterId = existing?.id ?? null;
  result.newCharacter = existing === null;

  if (!deps.force && isProfileFresh(existing?.lastProfileAt ?? null, now, deps.ttlMinutes)) {
    // Dentro del TTL no se llama a Blizzard (§28). Además de cuota, esto evita
    // que N búsquedas seguidas metan N snapshots casi idénticos: un histórico
    // append-only mide cambios, y una ráfaga de medidas iguales no mide nada.
    result.outcome = "cached";
    result.newCharacter = false;
    await recordLookup(deps.pool, deps.region, requestedAt, result);
    return result;
  }

  const fetched = await captureCharacter(deps.client, ref);
  result.outcome = fetched.outcome;
  result.note = fetched.note;

  if (!fetched.capture) {
    await recordLookup(deps.pool, deps.region, requestedAt, result);
    return result;
  }

  const { profile, brackets, gear, specializations } = fetched.capture;
  result.bracketsFound = brackets.length;

  // La spec activa decide de quién es el gear que devuelve la API: es uno solo,
  // el que lleva puesto ahora. Colgárselo también a los demás brackets sería
  // atribuir a un Frost Mage el equipo con el que juega de Fire, y esa build
  // acabaría contando en el adoption_rate de un segmento donde nadie la ha visto.
  const active = activeSpecOf(profile);
  const wearsGear = (spec: SpecEntry): boolean =>
    active !== null && specKey(active) === specKey(spec);

  const seasonOf = seasonResolver(deps.client);

  // Identidad canónica de Blizzard cuando la trae: quien busca puede haber
  // escrito el reino de otra forma, y la identidad tiene que coincidir con la
  // que usa la ingesta de leaderboard o el mismo jugador entraría dos veces.
  const realmSlug = profile.realm?.slug ?? ref.realmSlug;
  const nameSlug = (profile.name ?? ref.nameSlug).toLowerCase();

  const client = await deps.pool.connect();
  try {
    await client.query("begin");

    const idByKey = await upsertCharacters(client, deps.region, [
      {
        realmSlug,
        nameSlug,
        nameDisplay: profile.name ?? ref.nameSlug,
        faction: profile.faction?.type ?? null,
        blizzardCharacterId: typeof profile.id === "number" ? profile.id : null,
      },
    ]);

    const characterId = idByKey.get(identityKey(realmSlug, nameSlug));
    if (!characterId) {
      throw new Error(`No se pudo resolver el id interno de ${formatCharacterRef(ref)}.`);
    }
    result.characterId = characterId;

    for (const { ref: bracketRef, stats } of brackets) {
      // Sin rating no hay snapshot que insertar (la columna es not null): el
      // bracket sale en el resumen pero el personaje no tiene rating esta
      // temporada. Es rotación, un dato más, no un error.
      if (typeof stats.rating !== "number") continue;

      const talentCode = specializations
        ? findTalentLoadout(specializations, bracketRef.spec).code
        : null;
      if (talentCode) result.talentCodes++;

      const bracketGear = wearsGear(bracketRef.spec) ? gear : [];
      result.gearRows += bracketGear.length;

      const { isNew } = await insertProfileSnapshot(client, {
        characterId,
        // Mismo captured_at para todos los brackets de esta búsqueda: es una
        // sola observación del personaje, y el índice único hace que repetir la
        // búsqueda dentro del mismo instante no duplique población.
        capturedAt: requestedAt,
        source: "search",
        seasonId: await seasonOf(stats),
        bracket: bracketRef.bracket,
        spec: bracketRef.spec,
        rating: stats.rating,
        matchesPlayed: stats.season_match_statistics?.played ?? null,
        matchesWon: stats.season_match_statistics?.won ?? null,
        matchesLost: stats.season_match_statistics?.lost ?? null,
        pvpTierId: stats.tier?.id ?? null,
        averageItemLevel: profile.average_item_level ?? null,
        equippedItemLevel: profile.equipped_item_level ?? null,
        talentCode,
        gear: bracketGear,
      });
      if (isNew) result.snapshotsInserted++;
    }

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }

  await recordLookup(deps.pool, deps.region, requestedAt, result);
  return result;
}

// --- CLI ---

interface Options {
  refs: CharacterRef[];
  force: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { refs: [], force: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (!flag?.startsWith("--")) continue;

    if (flag === "--force") {
      options.force = true;
      continue;
    }

    const value = args[i + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new Error(`La opción ${flag} necesita un valor.`);
    }
    i++;

    if (flag !== "--character") {
      throw new Error(`Opción desconocida: ${flag}. Disponibles: --character, --force.`);
    }
    options.refs.push(parseCharacterRef(value));
  }

  if (options.refs.length === 0) {
    throw new Error(
      "Falta --character reino/nombre (se puede repetir para buscar varios personajes).",
    );
  }

  return options;
}

function describe(result: LookupResult): string {
  switch (result.outcome) {
    case "cached":
      return "ya lo teníamos fresco, no se ha llamado a Blizzard";
    case "not-found":
      return "Blizzard no conoce ese personaje (revisa reino y nombre)";
    case "no-brackets":
      return "existe, pero no juega ningún Solo Shuffle";
    case "error":
      return `no se pudo completar — ${result.note ?? "sin detalle"}`;
    case "ok":
      return (
        `${result.bracketsFound} bracket(s), ${result.snapshotsInserted} snapshot(s), ` +
        `${result.gearRows} filas de gear, ${result.talentCodes} con código de talentos`
      );
  }
}

export async function lookupCharacters(args: string[] = []): Promise<void> {
  const options = parseOptions(args);
  const region = getRegion();
  const ttlMinutes = getCharacterLookupTtlMinutes();

  getDatabaseUrl();

  console.log(`Búsqueda bajo demanda — región ${region.toUpperCase()}`);
  console.log(
    `Caché: ${ttlMinutes} min${options.force ? " (ignorada por --force)" : ""} · ` +
      `${options.refs.length} personaje(s)\n`,
  );

  // La prioridad más alta de §28: detrás de esto hay alguien esperando delante
  // de una pantalla, a diferencia del leaderboard y de los agregados.
  const client = new BlizzardClient({ priority: "on-demand" });
  const pool = createPool();
  const results: LookupResult[] = [];

  try {
    for (const ref of options.refs) {
      const result = await lookupCharacter(
        { pool, client, region, ttlMinutes, force: options.force },
        ref,
      );
      results.push(result);

      const icon = result.outcome === "ok" ? "✅" : result.outcome === "error" ? "❌" : "ℹ️";
      console.log(`${icon} ${formatCharacterRef(ref)}: ${describe(result)}`);
      if (result.newCharacter && result.outcome !== "not-found") {
        console.log("   Personaje nuevo: no estaba en la base de datos.");
      }
      if (result.note && result.outcome === "ok") console.log(`   ⚠️  ${result.note}`);
    }
  } finally {
    await pool.end();
  }

  const nuevos = results.filter((r) => r.newCharacter && r.outcome !== "not-found").length;
  const snapshots = results.reduce((acc, r) => acc + r.snapshotsInserted, 0);
  console.log(
    `\n${nuevos}/${results.length} personaje(s) no estaban en la base — ` +
      `${snapshots} snapshot(s) insertados.`,
  );
  console.log(`Cuota: ${formatUsage(blizzardUsage())}`);
}
