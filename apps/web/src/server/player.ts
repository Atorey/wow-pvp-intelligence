import type { PlayerRoute, Region } from "@wowpvp/core";
import {
  GEAR_KINDS,
  readActivity,
  readLatestGear,
  readLatestObservedSeason,
  readLatestSnapshotsByBracket,
  readLatestTalents,
  readPeakRating,
  readStanding,
  type ActivityRead,
  type AdoptionRead,
  type CharacterGearRead,
  type CharacterSnapshotRead,
  type Queryable,
  type SegmentRead,
} from "@wowpvp/data";
import { cache } from "react";
import { cachedAdoptionFor, cachedBracketSegments } from "./aggregate-cache";
import { getDb } from "./db";
import "./env";
import {
  gapFor,
  observedSpecs,
  pickSpec,
  standingFor,
  type AdoptionSides,
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

  const [peakRating, activity, gear, talents, standing, segments] = await Promise.all([
    readPeakRating(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readActivity(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readLatestGear(db, { ...key, bracket, seasonId }),
    readLatestTalents(db, { ...key, bracket, seasonId }),
    readStanding(db, { ...own, rating: snapshot.rating }),
    // Las tres lecturas de agregado van por la caché de proceso: son las mismas
    // para todo el que mire esta spec y cambian una vez al día (ADR 0031).
    cachedBracketSegments(db, own),
  ]);

  const view = standingFor({ rating: snapshot.rating, standing, segments });
  // El segmento objetivo se busca en lo ya leído y no se pide aparte: una fila
  // de otra corrida junto a las de esta pintaría dos poblaciones en la misma
  // página. Que no esté significa que esa corrida no lo calculó, y eso es una
  // respuesta —población cero observada— y no un hueco que rellenar con ayer.
  const target = segments.find((row) => row.segment.id === view.targetSegment?.id) ?? null;

  const equippedItemLevel = snapshot.equippedItemLevel ?? gear?.equippedItemLevel ?? null;
  const ownRow = segments.find((row) => row.segment.id === view.ownSegment.id) ?? null;
  const adoptions = await readAdoptions(db, ownRow, target);

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
      player: { itemLevel: equippedItemLevel, gear, talents },
      target,
      adoptions,
    }),
    standing: view,
    gear,
  };
}

/**
 * Las adopciones de los dos escalones, en dos consultas.
 *
 * Se piden siempre que existan las dos filas y no solo cuando la caja va a
 * comparar, y es a propósito: decidir aquí si hace falta obligaría a repetir
 * fuera de `gapFor()` el umbral que solo `canShowComparison()` puede aplicar, y
 * ese es exactamente el `if (n > 30)` suelto que prohíbe la regla 2. Cuando no
 * hay base tampoco hay filas que traer, así que lo que se ahorraría es una
 * consulta que devuelve cero.
 */
async function readAdoptions(
  db: Queryable,
  own: SegmentRead | null,
  target: SegmentRead | null,
): Promise<{ gear: AdoptionSides; talentNodes: AdoptionSides }> {
  const empty = { own: [], target: [] } as const;
  if (!own || !target) return { gear: empty, talentNodes: empty };

  const [gear, talentNodes] = await Promise.all([
    cachedAdoptionFor(db, [own, target], GEAR_KINDS),
    cachedAdoptionFor(db, [own, target], "talent-node"),
  ]);

  const sides = (byRowId: Map<string, AdoptionRead[]>): AdoptionSides => ({
    own: byRowId.get(own.rowId) ?? [],
    target: byRowId.get(target.rowId) ?? [],
  });

  return { gear: sides(gear), talentNodes: sides(talentNodes) };
}

/**
 * El mismo perfil, cargado una sola vez por petición.
 *
 * `generateMetadata` necesita saber si la caja Player Gap tiene comparación para
 * decidir si la página se indexa (ADR 0029, decisión 4), y eso solo lo sabe el
 * perfil entero. Sin memoizar, cada visita a un perfil haría el doble de
 * consultas contra el pooler.
 *
 * Los argumentos son primitivos y no la `PlayerRoute` a propósito: `cache`
 * compara por identidad, y un objeto recién construido por `resolvePlayerRoute`
 * nunca es el mismo dos veces —la memoización no fallaría ruidosamente, se
 * limitaría a no existir—.
 */
export const cachedPlayerProfile = cache(
  async (
    region: Region,
    realmSlug: string,
    nameSlug: string,
    requestedSpec: string | undefined,
  ): Promise<PlayerProfile | null> =>
    loadPlayerProfile({ region, realmSlug, nameSlug }, requestedSpec),
);
