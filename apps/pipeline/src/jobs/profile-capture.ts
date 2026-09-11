import type pg from "pg";
import type { SpecEntry } from "@wowpvp/core";
import {
  insertProfileSnapshot,
  type BlizzardClient,
  type EquipmentResponse,
  type GearRow,
  type HeroTreeRef,
  type ProfileResponse,
  type PvpBracketResponse,
  type SpecializationsResponse,
  type TalentRow,
} from "@wowpvp/blizzard";

/**
 * Qué es "bajar un perfil completo": las cuatro llamadas que lo componen y la
 * escritura del snapshot que sale de ellas.
 *
 * Está aparte porque hay dos jobs que bajan perfiles por segmento —el muestreo
 * manual de Sprint 0 (`sample-profiles`) y la ingesta continua
 * (`refresh-profiles`)— y lo que producen acaba en el mismo denominador. Si
 * cada uno pidiese sus endpoints por su cuenta, un cambio en la forma del
 * perfil se aplicaría a una parte de la población y no a la otra, y el
 * `adoption_rate` estaría calculado sobre dos cosas distintas sin que nada lo
 * dijera.
 */

/** Respuesta cruda tal cual llega, para poder reprocesarla sin volver a llamar. */
export interface Captured<T> {
  status: number;
  data: T | null;
}

/** Las cuatro respuestas que hacen falta para un snapshot de perfil. */
export interface ProfileParts {
  profile: Captured<ProfileResponse>;
  bracketStats: Captured<PvpBracketResponse>;
  equipment: Captured<EquipmentResponse>;
  specializations: Captured<SpecializationsResponse>;
}

export interface ProfileTarget {
  realmSlug: string;
  nameSlug: string;
  /** Bracket de shuffle del que se quiere el rating (`shuffle-mage-frost`). */
  bracket: string;
}

/** Coste en peticiones de un perfil completo. Lo que convierte presupuesto en personajes. */
export const REQUESTS_PER_PROFILE = 4;

/**
 * Baja el perfil completo de un personaje: 4 peticiones.
 *
 * A la vez, y todas por BlizzardClient (regla 4). Encadenarlas con `await` no
 * respetaba mejor el ritmo global —de eso se encarga la cola, que reparte
 * turnos espaciados y es la que sabe lo que hay pidiendo turno (ADR 0005)— y
 * hacía que el coste de un perfil fuese la **suma** de cuatro idas y vueltas a
 * Blizzard en vez del turno más lento. El ritmo real medido así se quedaba en
 * una cuarta parte del techo configurado, con el bucket horario compartido
 * intacto: el cuello no era la cuota, era esperar cuatro veces seguidas.
 *
 * Las cuatro son independientes entre sí: ninguna necesita lo que devuelve
 * otra, y el llamante ya sabe que el personaje existe.
 *
 * El bracket ya lo conocemos por la spec ingerida, así que se pide directo en
 * vez de pasar por pvp-summary como hace la búsqueda bajo demanda (que sí tiene
 * que descubrir qué brackets juega un personaje cualquiera).
 */
export async function fetchProfileParts(
  client: BlizzardClient,
  target: ProfileTarget,
): Promise<ProfileParts> {
  const base = `/profile/wow/character/${encodeURIComponent(target.realmSlug)}/${encodeURIComponent(target.nameSlug)}`;

  const [profile, bracketStats, equipment, specializations] = await Promise.all([
    client.tryGet<ProfileResponse>(base, "profile"),
    client.tryGet<PvpBracketResponse>(`${base}/pvp-bracket/${target.bracket}`, "profile"),
    client.tryGet<EquipmentResponse>(`${base}/equipment`, "profile"),
    client.tryGet<SpecializationsResponse>(`${base}/specializations`, "profile"),
  ]);

  return {
    profile: { status: profile.status, data: profile.data },
    bracketStats: { status: bracketStats.status, data: bracketStats.data },
    equipment: { status: equipment.status, data: equipment.data },
    specializations: { status: specializations.status, data: specializations.data },
  };
}

export interface ProfileSnapshotDraft {
  characterId: string;
  /** Marca temporal común de la corrida, nunca now(): ver comentario de idempotencia. */
  capturedAt: string;
  seasonId: number;
  bracket: string;
  spec: SpecEntry;
  rating: number;
  stats: PvpBracketResponse;
  profile: ProfileResponse | null;
  talentCode: string | null;
  /** Nodos del mismo loadout que `talentCode`, más los talentos PvP de la spec. */
  talents: readonly TalentRow[];
  heroTree: HeroTreeRef | null;
  gear: readonly GearRow[];
}

/**
 * Inserta el snapshot con su gear y sus talentos en una transacción. El INSERT en sí vive en
 * db/snapshots.ts, compartido también con la búsqueda bajo demanda: las tres
 * fuentes escriben la misma forma de snapshot y solo difieren en el `source`.
 *
 * Siempre `source = 'profile'`: lo que entra por aquí lo hemos elegido nosotros
 * muestreando, no lo ha traído el interés de un usuario por un personaje
 * concreto (eso es `'search'`, y se excluye del denominador por ADR 0007).
 *
 * Devuelve false si el snapshot ya existía, que es lo normal al reanudar o
 * repetir una corrida.
 */
export async function saveProfileSnapshot(
  pool: pg.Pool,
  draft: ProfileSnapshotDraft,
): Promise<boolean> {
  const client = await pool.connect();
  try {
    await client.query("begin");

    const { isNew } = await insertProfileSnapshot(client, {
      characterId: draft.characterId,
      capturedAt: draft.capturedAt,
      source: "profile",
      seasonId: draft.seasonId,
      bracket: draft.bracket,
      spec: draft.spec,
      rating: draft.rating,
      matchesPlayed: draft.stats.season_match_statistics?.played ?? null,
      matchesWon: draft.stats.season_match_statistics?.won ?? null,
      matchesLost: draft.stats.season_match_statistics?.lost ?? null,
      pvpTierId: draft.stats.tier?.id ?? null,
      averageItemLevel: draft.profile?.average_item_level ?? null,
      equippedItemLevel: draft.profile?.equipped_item_level ?? null,
      talentCode: draft.talentCode,
      talents: draft.talents,
      heroTree: draft.heroTree,
      gear: draft.gear,
    });

    await client.query("commit");
    return isNew;
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}
