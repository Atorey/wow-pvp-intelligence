import type { PlayerRoute } from "@wowpvp/core";
import {
  readActivity,
  readBracketSegments,
  readLatestGear,
  readLatestObservedSeason,
  readLatestSnapshotsByBracket,
  readPeakRating,
  readStanding,
  type ActivityRead,
  type CharacterGearRead,
  type CharacterSnapshotRead,
} from "@wowpvp/data";
import { getDb } from "./db";
import "./env";
import {
  gapFor,
  observedSpecs,
  pickSpec,
  standingFor,
  type GapView,
  type ObservedSpec,
  type StandingView,
} from "./player-profile";

/**
 * Lo que la página de perfil necesita de Postgres, en una sola función.
 *
 * Las lecturas son de `@wowpvp/data` y no hay SQL aquí (ADR 0014): lo que este
 * módulo decide es **cuáles** se piden y en qué orden, que es lo que cambia
 * según la spec elegida. Todo lo que se decide con los datos ya cargados vive
 * en `player-profile.ts`, sin base de datos, porque es lo que merece test.
 */
export interface PlayerProfile {
  seasonId: number;
  /** La observación más reciente de la spec que se está enseñando. */
  snapshot: CharacterSnapshotRead;
  /** Todas las specs observadas del personaje, para el selector. */
  specs: ObservedSpec[];
  active: ObservedSpec;
  /** El rating más alto que le hemos visto en esta spec y temporada. */
  peakRating: number | null;
  /**
   * El item level equipado, de la observación más reciente que lo traiga.
   *
   * El último snapshot suele venir del leaderboard, que no lo trae: quedarse
   * con su null pintaría un guion al lado de la lista de equipo que sí tenemos,
   * y eso no es "no disponible", es mirar la fila equivocada.
   */
  equippedItemLevel: number | null;
  activity: ActivityRead | null;
  gap: GapView;
  standing: StandingView;
  gear: CharacterGearRead | null;
}

/**
 * El perfil, o `null` si de ese personaje no consta ni una observación.
 *
 * `null` **no es "no existe"**: por debajo del corte de 5.000 del leaderboard
 * solo entra al dataset quien ha sido buscado (§12), así que lo que falta es la
 * búsqueda. Y no se le pregunta a Blizzard desde aquí: esto se sirve por `GET`,
 * y una llamada colgada de un `GET` la dispara cualquier precarga y la paga la
 * cuota compartida con el pipeline (ADR 0024, decisión 2).
 */
export async function loadPlayerProfile(
  route: PlayerRoute,
  requestedSpec?: string,
): Promise<PlayerProfile | null> {
  const db = getDb();
  const key = { region: route.region, realmSlug: route.realmSlug, nameSlug: route.nameSlug };

  // La temporada es la última en la que consta este personaje y no la que
  // Blizzard llame actual: preguntárselo cuesta dos llamadas por visita, y lo
  // que la página enseña es lo último que sabemos de él.
  const seasonId = await readLatestObservedSeason(db, key);
  if (seasonId === null) return null;

  const snapshots = await readLatestSnapshotsByBracket(db, { ...key, seasonId });
  const specs = observedSpecs(snapshots);
  const active = pickSpec(specs, requestedSpec);
  if (!active) return null;

  const snapshot = snapshots.find((row) => row.bracket === active.bracket);
  if (!snapshot) return null;

  const bracket = active.bracket;
  const own = { region: route.region, seasonId, bracket };

  const [peakRating, activity, gear, standing, segments] = await Promise.all([
    readPeakRating(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readActivity(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readLatestGear(db, { ...key, bracket, seasonId }),
    readStanding(db, { ...own, rating: snapshot.rating }),
    readBracketSegments(db, own),
  ]);

  const view = standingFor({ rating: snapshot.rating, standing, segments });
  // El segmento objetivo se busca en lo ya leído y no se pide aparte: una fila
  // de otra corrida junto a las de esta pintaría dos poblaciones en la misma
  // página. Que no esté significa que esa corrida no lo calculó, y eso es una
  // respuesta —población cero observada— y no un hueco que rellenar con ayer.
  const target = segments.find((row) => row.segment.id === view.targetSegment?.id) ?? null;

  const equippedItemLevel = snapshot.equippedItemLevel ?? gear?.equippedItemLevel ?? null;

  return {
    seasonId,
    snapshot,
    specs,
    active,
    peakRating,
    equippedItemLevel,
    activity,
    gap: gapFor({
      rating: snapshot.rating,
      playerItemLevel: equippedItemLevel,
      target,
    }),
    standing: view,
    gear,
  };
}
