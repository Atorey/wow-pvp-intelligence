import { gunzipSync, gzipSync } from "node:zlib";
import {
  parseRatingHistoryShard,
  ratingHistoryPath,
  serializeRatingHistoryShard,
  type RatingHistoryShard,
} from "@wowpvp/core";
import { downloadObject, uploadObject, type Fetch, type StorageConfig } from "./client";

/**
 * El índice por personaje del histórico de rating, en Storage (ADR 0039).
 *
 * El formato y las reglas de fusión son de `packages/core`; aquí solo está el
 * viaje: comprimir, subir, bajar y descomprimir.
 */

/**
 * El shard de una temporada, o `null` si todavía no existe.
 *
 * Que no exista no es un error: una temporada recién empezada no ha archivado
 * nada, y ninguno de sus personajes tiene todavía puntos fuera de Postgres.
 */
export async function readRatingHistoryShard(
  config: StorageConfig,
  seasonId: number,
  shard: string,
  fetchFn: Fetch = fetch,
): Promise<RatingHistoryShard | null> {
  const body = await downloadObject(config, ratingHistoryPath(seasonId, shard), fetchFn);
  if (!body) return null;

  const read = parseRatingHistoryShard(gunzipSync(body).toString("utf8"));
  // Un fichero en la ruta equivocada se leería como la serie de otro.
  if (read.seasonId !== seasonId || read.shard !== shard) {
    throw new Error(
      `El objeto ${ratingHistoryPath(seasonId, shard)} dice ser el shard ${read.shard} ` +
        `de la temporada ${read.seasonId}.`,
    );
  }
  return read;
}

/** Sube un shard entero, sobrescribiendo el anterior. Devuelve los bytes subidos. */
export async function writeRatingHistoryShard(
  config: StorageConfig,
  shard: RatingHistoryShard,
  fetchFn: Fetch = fetch,
): Promise<number> {
  const body = gzipSync(serializeRatingHistoryShard(shard));
  await uploadObject(
    config,
    ratingHistoryPath(shard.seasonId, shard.shard),
    body,
    { upsert: true },
    fetchFn,
  );
  return body.length;
}
