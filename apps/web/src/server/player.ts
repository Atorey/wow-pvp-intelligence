import type { PlayerRoute, Region } from "@wowpvp/core";
import {
  GEAR_KINDS,
  readActivity,
  readCharacterIdentity,
  readLatestGear,
  readLatestObservedSeason,
  readLatestSnapshotsByBracket,
  readLatestTalents,
  readObservedSpecs,
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
import { publishedBrackets } from "./published";
import { loadClosedSeason, type ClosedSeasonView } from "./rating-history";
import "./env";
import {
  comparisonRowsFor,
  gapFor,
  observedSpecs,
  pickSpec,
  standingFor,
  unattributedBrackets,
  type AdoptionSides,
  type GapView,
  type ObservedSpec,
  type StandingView,
  type UnattributedBracket,
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
  /** Todas las specs observadas del personaje, por modalidad, para el selector. */
  specs: ObservedSpec[];
  active: ObservedSpec;
  /** Las modalidades de arena con rating y sin spec observada (ADR 0048). */
  withoutSpec: UnattributedBracket[];
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
  requestedBracket?: string,
): Promise<PlayerProfile | null> {
  const db = getDb();
  const key = { region: route.region, realmSlug: route.realmSlug, nameSlug: route.nameSlug };

  // La temporada es la última en la que consta este personaje y no la que
  // Blizzard llame actual: preguntárselo cuesta dos llamadas por visita, y lo
  // que la página enseña es lo último que sabemos de él.
  const seasonId = await readLatestObservedSeason(db, key);
  if (seasonId === null) return null;

  // La spec de cada bracket va aparte porque en arena la última observación suele
  // ser de leaderboard, que no la trae (ADR 0048).
  const [snapshots, specsByBracket] = await Promise.all([
    readLatestSnapshotsByBracket(db, { ...key, seasonId }),
    readObservedSpecs(db, { ...key, seasonId }),
  ]);
  const options = { specs: specsByBracket, published: publishedBrackets() };
  const specs = observedSpecs(snapshots, options);
  const active = pickSpec(specs, requestedSpec, requestedBracket);
  if (!active) return null;

  const snapshot = snapshots.find((row) => row.bracket === active.bracket);
  if (!snapshot) return null;

  const bracket = active.bracket;
  const own = {
    region: route.region,
    seasonId,
    bracket,
    classSlug: active.spec.classSlug,
    specSlug: active.spec.specSlug,
  };
  const arena = active.specObservedAt !== null;

  const [peakRating, activity, gear, talents, standing, segments] = await Promise.all([
    readPeakRating(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readActivity(db, { characterId: snapshot.characterId, bracket, seasonId }),
    readLatestGear(db, { ...key, bracket, seasonId }),
    readLatestTalents(db, { ...key, bracket, seasonId }),
    // En arena cuenta el bracket entero: la lectura filtra por bracket y no por
    // spec, y eso es lo que se declara en pantalla.
    readStanding(db, { region: own.region, seasonId, bracket, rating: snapshot.rating }),
    // Las tres lecturas de agregado van por la caché de proceso: son las mismas
    // para todo el que mire esta spec y cambian una vez al día (ADR 0031).
    cachedBracketSegments(db, own),
  ]);

  const view = standingFor({ rating: snapshot.rating, standing, segments, wholeBracket: arena });
  // El objetivo se busca en lo ya leído y no se pide aparte: una fila de otra
  // corrida junto a las de esta pintaría dos poblaciones en la misma página. Y
  // lo elige la misma función que decide la caja, para que las adopciones que se
  // leen sean las del escalón que nombra su titular (ADR 0051).
  const rows = comparisonRowsFor(snapshot.rating, segments);

  const equippedItemLevel = snapshot.equippedItemLevel ?? gear?.equippedItemLevel ?? null;
  const adoptions = await readAdoptions(db, rows.own, rows.target);

  return {
    seasonId,
    snapshot,
    specs,
    active,
    withoutSpec: unattributedBrackets(snapshots, options),
    peakRating,
    equippedItemLevel,
    activity,
    gap: gapFor({
      rating: snapshot.rating,
      player: { itemLevel: equippedItemLevel, gear, talents },
      segments,
      adoptions,
    }),
    standing: view,
    gear,
  };
}

/**
 * Por qué no hay perfil, que no es una sola cosa.
 *
 * `loadPlayerProfile()` devuelve `null` en dos situaciones que la pantalla tiene
 * que contar de forma distinta: del personaje no consta nada, o consta su
 * identidad y ninguna observación con rating. La segunda es el personaje que
 * existe y no tiene rating esta temporada —rotación, una vuelta, un año sin
 * jugar con clasificación— y de él sí hay constancia de haber preguntado a
 * Blizzard, así que decirle "nadie lo ha consultado aquí" es afirmar algo falso
 * sobre lo que tenemos.
 */
export type PlayerAbsence =
  /** No está en la población: nadie lo ha buscado y no se le ha visto en la ladder. */
  | { state: "unknown" }
  /**
   * Está en la población y no le consta rating. `askedAt` es la última vez que se
   * le preguntó a Blizzard, `null` si no consta ninguna: su identidad pudo entrar
   * por el leaderboard, que no pasa por la bitácora.
   *
   * `closedSeason` es la última temporada cerrada en la que sí consta, leída de
   * Storage porque ya no está en Postgres (ADR 0042). `null` si no consta en
   * ninguna o si Storage no contestó: en los dos casos no se afirma nada de ella.
   */
  | {
      state: "no-rating";
      nameDisplay: string;
      askedAt: Date | null;
      closedSeason: ClosedSeasonView | null;
    };

/**
 * Cuál de las dos ausencias es. Se pide **solo** cuando ya se sabe que no hay
 * perfil: una consulta más en la única página que no tiene nada que pintar.
 */
export async function loadPlayerAbsence(route: PlayerRoute): Promise<PlayerAbsence> {
  const identity = await readCharacterIdentity(getDb(), {
    region: route.region,
    realmSlug: route.realmSlug,
    nameSlug: route.nameSlug,
  });
  if (!identity) return { state: "unknown" };

  return {
    state: "no-rating",
    nameDisplay: identity.nameDisplay,
    askedAt: identity.lastAskedAt,
    closedSeason: await loadClosedSeason(identity.characterId),
  };
}

/**
 * Las adopciones del tramo propio y del objetivo, en dos consultas.
 *
 * Se piden siempre que exista la fila del objetivo y no solo cuando la caja va
 * a comparar, y es a propósito: decidir aquí si hace falta obligaría a repetir
 * fuera de `gapFor()` el umbral que solo `canShowComparison()` puede aplicar, y
 * ese es exactamente el `if (n > 30)` suelto que prohíbe la regla 2. Cuando no
 * hay base tampoco hay filas que traer, así que lo que se ahorraría es una
 * consulta que devuelve cero.
 *
 * La del tramo propio puede faltar sin que falte la caja: contra un objetivo
 * que no es el inmediato, el otro lado es el equipo de quien mira (ADR 0051).
 * En `peers` las dos son la misma fila y se pide una vez.
 */
async function readAdoptions(
  db: Queryable,
  own: SegmentRead | null,
  target: SegmentRead | null,
): Promise<{ gear: AdoptionSides; talentNodes: AdoptionSides }> {
  const empty = { own: [], target: [] } as const;
  if (!target) return { gear: empty, talentNodes: empty };

  const rows = own && own.rowId !== target.rowId ? [own, target] : [target];
  const [gear, talentNodes] = await Promise.all([
    cachedAdoptionFor(db, rows, GEAR_KINDS),
    cachedAdoptionFor(db, rows, "talent-node"),
  ]);

  const sides = (byRowId: Map<string, AdoptionRead[]>): AdoptionSides => ({
    own: own ? (byRowId.get(own.rowId) ?? []) : [],
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
    requestedBracket: string | undefined,
  ): Promise<PlayerProfile | null> =>
    loadPlayerProfile({ region, realmSlug, nameSlug }, requestedSpec, requestedBracket),
);
