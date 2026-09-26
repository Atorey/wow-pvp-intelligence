import {
  ratingHistoryShard,
  seriesKey,
  standingsInShard,
  type ClosedSeasonStanding,
  type RatingPoint,
} from "@wowpvp/core";
import { readArchivedSeasons, readRatingPoints } from "@wowpvp/data";
import { readRatingHistoryShard, type Fetch } from "@wowpvp/storage";
import { getDb } from "./db";
import { getHistoryStorage } from "./env";
import { logServerEvent } from "./log";
import { ratingHistoryFor, type RatingHistoryView } from "./rating-history-view";

/**
 * Cuánto se espera a Storage. Es la única lectura de la página que sale de
 * Postgres, y si tarda, la pestaña se sirve con lo caliente y con el hueco
 * declarado: mejor eso que una página colgada por media temporada (ADR 0031).
 */
const STORAGE_TIMEOUT_MS = 3_000;

const fetchWithTimeout: Fetch = (input, init) =>
  fetch(input, { ...init, signal: AbortSignal.timeout(STORAGE_TIMEOUT_MS) });

/**
 * La serie de rating de una spec en una temporada, con sus dos mitades unidas.
 *
 * Solo se va a Storage cuando la actividad dice que hay algo archivado: casi
 * todo el que tiene la temporada entera en los últimos 3 días (ADR 0041) —y todo el
 * dataset de desarrollo— se sirve con una consulta a Postgres y ninguna más.
 *
 * Se pide solo desde la pestaña de histórico, no con el perfil: el resumen no
 * la necesita y no tiene por qué pagar un viaje a Storage.
 */
export async function loadRatingHistory(
  key: { characterId: string; bracket: string; seasonId: number },
  archivedObservations: number,
): Promise<RatingHistoryView> {
  const hot = await readRatingPoints(getDb(), key);
  const archived = archivedObservations > 0 ? await readArchived(key) : null;
  return ratingHistoryFor({ hot, archived, archivedObservations });
}

/**
 * Cuántas temporadas cerradas se miran, de la más reciente hacia atrás. Cada una
 * es un viaje a Storage con su propio tope, y alguien que lleva más de dos
 * temporadas sin jugar Solo Shuffle con clasificación tiene poco que enseñar.
 */
const CLOSED_SEASONS_LOOKED_UP = 2;

export interface ClosedSeasonView {
  seasonId: number;
  standings: ClosedSeasonStanding[];
}

/**
 * La última temporada cerrada en la que consta un personaje, leída del índice de
 * rating de Storage (ADR 0042).
 *
 * Es la ficha de quien solo jugó una temporada que ya salió de Postgres: de ella
 * queda la serie de rating y nada más. `null` si no consta en ninguna, si Storage
 * no está configurado o si no contesta a tiempo; en los dos últimos casos la
 * página se queda con el estado de siempre en vez de afirmar que no jugó.
 */
export async function loadClosedSeason(characterId: string): Promise<ClosedSeasonView | null> {
  const storage = getHistoryStorage();
  if (!storage) return null;

  for (const seasonId of await readArchivedSeasons(getDb(), CLOSED_SEASONS_LOOKED_UP)) {
    try {
      const shard = await readRatingHistoryShard(
        storage,
        seasonId,
        ratingHistoryShard(characterId),
        fetchWithTimeout,
      );
      const standings = shard ? standingsInShard(shard, characterId) : [];
      if (standings.length > 0) return { seasonId, standings };
    } catch (error) {
      logServerEvent("rating-history-unavailable", {
        reason: error instanceof Error ? error.name : "unknown",
      });
      return null;
    }
  }
  return null;
}

async function readArchived(key: {
  characterId: string;
  bracket: string;
  seasonId: number;
}): Promise<RatingPoint[] | null> {
  const storage = getHistoryStorage();
  if (!storage) {
    logServerEvent("rating-history-unavailable", { reason: "unconfigured" });
    return null;
  }

  try {
    const shard = await readRatingHistoryShard(
      storage,
      key.seasonId,
      ratingHistoryShard(key.characterId),
      fetchWithTimeout,
    );
    // Un shard que no existe es un índice vacío, no uno ilegible: lo archivado
    // no ha llegado a indexarse, y eso se cuenta como puntos que faltan.
    return shard?.series.get(seriesKey(key.characterId, key.bracket)) ?? [];
  } catch (error) {
    logServerEvent("rating-history-unavailable", {
      reason: error instanceof Error ? error.name : "unknown",
    });
    return null;
  }
}
