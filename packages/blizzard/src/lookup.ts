import type { Queryable } from "@wowpvp/data";
import type pg from "pg";
import {
  formatCharacterRef,
  nameSlug,
  specSlug,
  type CharacterRef,
  type SpecEntry,
} from "@wowpvp/core";
import type { BlizzardClient } from "./client";
import {
  activeSpecOf,
  isProfileFresh,
  shuffleBracketsFromSummary,
  type PvpSummaryResponse,
  type ShuffleBracketRef,
} from "./character-lookup";
import { identityKey, upsertCharacters } from "./db/characters";
import { insertProfileSnapshot } from "./db/snapshots";
import {
  findTalentLoadout,
  mapEquipment,
  mapPvpTalents,
  type EquipmentResponse,
  type GearRow,
  type ProfileResponse,
  type PvpBracketResponse,
  type SpecializationsResponse,
} from "./profile-mapping";
import { resolveCurrentSeasonId } from "./season";

/**
 * Acumulación de población por búsqueda de usuario (§6 y §12, ADR 0006).
 *
 * El leaderboard solo expone el top 5.000 por spec, y en las specs más jugadas
 * ese corte cae por encima del ICP: Frost Mage no baja de ~1800, así que un
 * jugador de 1600 no está en nuestra base y no tiene con quién compararse. La
 * segunda vía de población del plan es esta — cada personaje que alguien
 * consulta entra al dataset, igual que hace Drustvar.
 *
 * Aquí está el motor, y lo llaman dos: el buscador de la web, que es quien de
 * verdad acumula población, y un comando del CLI que existe para ejercitarlo y
 * medirlo desde una terminal.
 */

/**
 * Cómo acabó una búsqueda. Se guarda en la bitácora tal cual, así que estos son
 * también los valores que admite el check de character_lookups.
 */
export type LookupOutcome =
  "ok" | "cached" | "not-found" | "not-found-cached" | "no-brackets" | "error";

export interface LookupResult {
  /** Lo que se pidió buscar, tal como venía. */
  ref: CharacterRef;
  /**
   * La identidad con la que quedó guardado, que es la de Blizzard y no siempre
   * la que se tecleó: quien busca puede escribir el reino de otra forma, y lo
   * que se publica como ruta es la forma canónica (ADR 0017). `null` cuando no
   * se llegó a guardar identidad ninguna.
   */
  stored: CharacterRef | null;
  outcome: LookupOutcome;
  characterId: string | null;
  /** ¿No lo teníamos? Es la métrica que dice si esta feature aporta población. */
  newCharacter: boolean;
  bracketsFound: number;
  snapshotsInserted: number;
  gearRows: number;
  talentCodes: number;
  note: string | null;
  /**
   * Por qué no se llegó a preguntar, cuando el cliente se quedó sin cuota o sin
   * presupuesto de tiempo (ADR 0013, decisión 7). Va aparte de `outcome` porque
   * la bitácora solo admite los cinco valores del check y porque quien tiene un
   * jugador delante necesita distinguir "no existe" de "ahora no puedo mirarlo".
   */
  unavailable: "quota" | "deadline" | null;
}

export interface LookupDeps {
  pool: pg.Pool;
  client: BlizzardClient;
  region: string;
  ttlMinutes: number;
  /**
   * Minutos que se recuerda un 404 (ADR 0030). Llega como número y no se lee del
   * entorno aquí por lo mismo que `ttlMinutes`: el motor no elige su política.
   */
  notFoundTtlMinutes: number;
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

/**
 * ¿Nos dijeron hace poco que este personaje no existe?
 *
 * Mira solo las filas que costaron una petición: contar también los aciertos de
 * caché haría que preguntar una vez por minuto mantuviese vigente la ventana
 * indefinidamente.
 */
export async function recentlyNotFound(
  pool: Queryable,
  region: string,
  ref: CharacterRef,
  since: Date,
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1
       from character_lookups
      where region = $1 and realm_slug = $2 and name_slug = $3
        and outcome = 'not-found'
        and requested_at > $4
      order by requested_at desc
      limit 1`,
    [region, ref.realmSlug, ref.nameSlug, since.toISOString()],
  );

  return rows.length > 0;
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
  unavailable: "quota" | "deadline" | null;
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
    return { capture: null, outcome: "not-found", note: null, unavailable: null };
  }
  if (!profile.ok || !profile.data) {
    return {
      capture: null,
      outcome: "error",
      note: `perfil: HTTP ${profile.status} — ${profile.error?.slice(0, 200) ?? "sin cuerpo"}`,
      // Sin la primera petición no hay nada que enseñar, así que es aquí donde
      // "no pude preguntar" tiene que sobrevivir hasta quien pinta la pantalla.
      unavailable: profile.unavailable ?? null,
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
      unavailable: summary.unavailable ?? null,
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
      unavailable: null,
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
    unavailable: null,
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
 * Recibe todo lo que necesita y no imprime nada, para que quien llame decida qué
 * enseñar: el CLI escribe en la terminal y la web pinta una pantalla.
 */
export async function lookupCharacter(deps: LookupDeps, ref: CharacterRef): Promise<LookupResult> {
  const now = deps.now?.() ?? new Date();
  const requestedAt = now.toISOString();

  const result: LookupResult = {
    ref,
    stored: null,
    outcome: "error",
    characterId: null,
    newCharacter: false,
    bracketsFound: 0,
    snapshotsInserted: 0,
    gearRows: 0,
    talentCodes: 0,
    note: null,
    unavailable: null,
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
    // Dentro del TTL no se ha preguntado, así que lo guardado es lo que ya
    // estaba: la identidad que se buscó, que es la que casó en `findExisting`.
    result.stored = ref;
    await recordLookup(deps.pool, deps.region, requestedAt, result);
    return result;
  }

  // Solo para quien no está en la población: si ya lo conocemos, un 404 significa
  // borrado o renombrado y de eso decide el TTL del perfil, no esta caché.
  if (
    !deps.force &&
    existing === null &&
    deps.notFoundTtlMinutes > 0 &&
    (await recentlyNotFound(
      deps.pool,
      deps.region,
      ref,
      new Date(now.getTime() - deps.notFoundTtlMinutes * 60_000),
    ))
  ) {
    result.outcome = "not-found-cached";
    await recordLookup(deps.pool, deps.region, requestedAt, result);
    return result;
  }

  const fetched = await captureCharacter(deps.client, ref);
  result.outcome = fetched.outcome;
  result.note = fetched.note;
  result.unavailable = fetched.unavailable;

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
    active !== null && specSlug(active) === specSlug(spec);

  const seasonOf = seasonResolver(deps.client);

  // Identidad canónica de Blizzard cuando la trae: quien busca puede haber
  // escrito el reino de otra forma, y la identidad tiene que coincidir con la
  // que usa la ingesta de leaderboard o el mismo jugador entraría dos veces.
  const realm = profile.realm?.slug ?? ref.realmSlug;
  const name = nameSlug(profile.name ?? ref.nameSlug);

  const client = await deps.pool.connect();
  try {
    await client.query("begin");

    const idByKey = await upsertCharacters(client, deps.region, [
      {
        realmSlug: realm,
        nameSlug: name,
        nameDisplay: profile.name ?? ref.nameSlug,
        faction: profile.faction?.type ?? null,
        blizzardCharacterId: typeof profile.id === "number" ? profile.id : null,
      },
    ]);

    const characterId = idByKey.get(identityKey(realm, name));
    if (!characterId) {
      throw new Error(`No se pudo resolver el id interno de ${formatCharacterRef(ref)}.`);
    }
    result.characterId = characterId;
    result.stored = { realmSlug: realm, nameSlug: name };

    for (const { ref: bracketRef, stats } of brackets) {
      // Sin rating no hay snapshot que insertar (la columna es not null): el
      // bracket sale en el resumen pero el personaje no tiene rating esta
      // temporada. Es rotación, un dato más, no un error.
      if (typeof stats.rating !== "number") continue;

      const talents = specializations ? findTalentLoadout(specializations, bracketRef.spec) : null;
      if (talents?.code) result.talentCodes++;

      // Los talentos PvP se piden aparte porque cuelgan de la spec y no del
      // loadout: existen aunque el personaje no lleve activa esta spec, que es
      // justo lo contrario que el gear (ADR 0026).
      const pvpTalents = specializations ? mapPvpTalents(specializations, bracketRef.spec) : null;

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
        talentCode: talents?.code ?? null,
        talents: [...(talents?.talents ?? []), ...(pvpTalents ?? [])],
        heroTree: talents?.heroTree ?? null,
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
