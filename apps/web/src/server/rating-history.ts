import { ratingHistoryShard, seriesKey, type RatingPoint } from "@wowpvp/core";
import { readRatingPoints } from "@wowpvp/data";
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
 * todo el que tiene la temporada entera en los últimos 14 días —y todo el
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
