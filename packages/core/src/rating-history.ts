/**
 * La serie de rating de un personaje, en la forma en que sobrevive al archivado
 * (ADR 0039).
 *
 * `character_snapshots` solo guarda 3 días (ADR 0034 y 0041), y el archivo de Storage
 * son lotes por fecha con la población entera dentro: leer de él la temporada
 * de **una** persona obligaría a bajarse todos. Así que el archivado deja además
 * un índice por personaje, con lo único que pinta el histórico —cuándo y qué
 * rating—, repartido en shards pequeños que la web puede leer de uno en uno.
 *
 * Aquí vive lo que el pipeline que escribe y la web que lee tienen que hacer
 * igual: qué shard le toca a quién, cómo se llama el objeto y cómo se juntan dos
 * trozos de la misma serie. Ni la compresión ni la red, que no son dominio.
 */

/** Carpeta del índice dentro del bucket del archivo, aparte de los lotes. */
export const RATING_HISTORY_PREFIX = "rating-history";

/** Un punto de la serie: una observación con su fecha. */
export interface RatingPoint {
  at: Date;
  rating: number;
}

/** Una observación con la identidad de su serie, tal como sale de un snapshot. */
export interface RatingObservation extends RatingPoint {
  characterId: string;
  bracket: string;
  seasonId: number;
}

/**
 * Un shard: todas las series de una temporada cuyos personajes caen en él.
 *
 * `series` va por `seriesKey()` y cada lista está ordenada por fecha y sin
 * repetidos, que es lo que garantiza `mergeRatingPoints()`.
 */
export interface RatingHistoryShard {
  seasonId: number;
  shard: string;
  series: Map<string, RatingPoint[]>;
}

/**
 * El shard de un personaje: los dos primeros caracteres de su id.
 *
 * No hace falta un hash porque el id ya lo es: `characters.id` es un uuid v4, y
 * sus dos primeros dígitos hexadecimales reparten la población en 256 partes
 * iguales. Con la temporada 42 eso son unas 400 series por objeto, unas decenas
 * de KB comprimidas: lo que cuesta una visita a la pestaña, no más.
 */
export function ratingHistoryShard(characterId: string): string {
  const shard = characterId.slice(0, 2).toLowerCase();
  if (!/^[0-9a-f]{2}$/.test(shard)) {
    throw new Error(
      `El id de personaje "${characterId}" no empieza por dos dígitos hexadecimales.`,
    );
  }
  return shard;
}

/** La ruta del objeto dentro del bucket. Una carpeta por temporada. */
export function ratingHistoryPath(seasonId: number, shard: string): string {
  return `${RATING_HISTORY_PREFIX}/s${seasonId}/${shard}.json.gz`;
}

/**
 * La clave de una serie dentro de su shard.
 *
 * El bracket va en la clave y no en la ruta porque un mismo personaje juega
 * varias specs, y cada una es su propio bracket y su propia serie: separarlas
 * por objeto multiplicaría los ficheros sin ahorrar lectura.
 */
export function seriesKey(characterId: string, bracket: string): string {
  return `${characterId}|${bracket}`;
}

/**
 * La unión de dos trozos de una misma serie, por fecha y sin repetidos.
 *
 * Dos puntos con la misma fecha al milisegundo son **la misma observación**:
 * es lo que pasa con una fila que ya estaba en el índice y sigue caliente en
 * Postgres —el ancla, el pico, o un lote que se indexó y no llegó a borrarse—.
 * La unión es conmutativa e idempotente, que es lo que permite volver a indexar
 * un lote o correr el backfill encima del job diario sin contar nada dos veces.
 */
export function mergeRatingPoints(...parts: readonly (readonly RatingPoint[])[]): RatingPoint[] {
  const byTime = new Map<number, RatingPoint>();
  for (const part of parts) {
    for (const point of part) {
      const time = point.at.getTime();
      if (!byTime.has(time)) byTime.set(time, point);
    }
  }
  return [...byTime.values()].sort((a, b) => a.at.getTime() - b.at.getTime());
}

export function emptyRatingHistoryShard(seasonId: number, shard: string): RatingHistoryShard {
  return { seasonId, shard, series: new Map() };
}

/**
 * Añade observaciones a un shard y devuelve cuántas series tocó.
 *
 * Rechaza la que no es suya en vez de colocarla donde toca: un shard que acepta
 * a cualquiera acaba con series que nadie buscará nunca en él, porque la web
 * solo mira el shard que dice `ratingHistoryShard()`.
 */
export function addToRatingHistoryShard(
  target: RatingHistoryShard,
  observations: readonly RatingObservation[],
): number {
  const incoming = new Map<string, RatingPoint[]>();
  for (const observation of observations) {
    if (
      observation.seasonId !== target.seasonId ||
      ratingHistoryShard(observation.characterId) !== target.shard
    ) {
      throw new Error(
        `La observación de ${observation.characterId} (temporada ${observation.seasonId}) no ` +
          `pertenece al shard ${target.shard} de la temporada ${target.seasonId}.`,
      );
    }
    const key = seriesKey(observation.characterId, observation.bracket);
    const list = incoming.get(key) ?? [];
    list.push({ at: observation.at, rating: observation.rating });
    incoming.set(key, list);
  }

  for (const [key, points] of incoming) {
    target.series.set(key, mergeRatingPoints(target.series.get(key) ?? [], points));
  }
  return incoming.size;
}

/**
 * Qué shards y de qué temporada tocan unas observaciones, agrupadas.
 *
 * La clave es la ruta del objeto: es lo que hay que bajar, fundir y volver a
 * subir, una vez por objeto y no una vez por observación.
 */
export function groupByRatingHistoryObject(
  observations: readonly RatingObservation[],
): Map<string, { seasonId: number; shard: string; observations: RatingObservation[] }> {
  const groups = new Map<
    string,
    { seasonId: number; shard: string; observations: RatingObservation[] }
  >();
  for (const observation of observations) {
    const shard = ratingHistoryShard(observation.characterId);
    const path = ratingHistoryPath(observation.seasonId, shard);
    const group = groups.get(path) ?? { seasonId: observation.seasonId, shard, observations: [] };
    group.observations.push(observation);
    groups.set(path, group);
  }
  return groups;
}

/**
 * La forma en disco: JSON con cada punto como `[milisegundos, rating]`.
 *
 * Tuplas y no objetos porque son cientos de miles de puntos y las claves
 * repetidas serían la mitad del fichero. `v` es la versión del formato: el día
 * que cambie, quien lea un shard viejo tiene que poder saberlo en vez de
 * interpretarlo mal.
 */
interface ShardJson {
  v: 1;
  season: number;
  shard: string;
  series: Record<string, [number, number][]>;
}

export function serializeRatingHistoryShard(shard: RatingHistoryShard): string {
  const series: Record<string, [number, number][]> = {};
  // Ordenadas por clave para que el mismo contenido dé siempre el mismo fichero.
  for (const key of [...shard.series.keys()].sort()) {
    series[key] = (shard.series.get(key) ?? []).map((point) => [point.at.getTime(), point.rating]);
  }
  const json: ShardJson = { v: 1, season: shard.seasonId, shard: shard.shard, series };
  return JSON.stringify(json);
}

/**
 * Lee un shard y falla ante cualquier cosa que no sea exactamente el formato.
 *
 * Falla en vez de saltarse lo raro porque lo que se pinta con esto es la
 * temporada de una persona: un punto mal leído es un rating que no tuvo, y una
 * serie a medias se leería como una temporada entera.
 */
export function parseRatingHistoryShard(text: string): RatingHistoryShard {
  const json = JSON.parse(text) as Partial<ShardJson>;
  if (
    json.v !== 1 ||
    typeof json.season !== "number" ||
    typeof json.shard !== "string" ||
    typeof json.series !== "object" ||
    json.series === null
  ) {
    throw new Error("El shard del histórico de rating no tiene el formato de la versión 1.");
  }

  const series = new Map<string, RatingPoint[]>();
  for (const [key, points] of Object.entries(json.series)) {
    if (!Array.isArray(points)) {
      throw new Error(`La serie ${key} del shard ${json.shard} no es una lista.`);
    }
    const read = points.map((point: unknown) => {
      const [time, rating] = Array.isArray(point) ? (point as unknown[]) : [];
      if (!Number.isFinite(time) || !Number.isInteger(rating)) {
        throw new Error(`La serie ${key} del shard ${json.shard} tiene un punto mal formado.`);
      }
      return { at: new Date(time as number), rating: rating as number };
    });
    // Pasa por la unión aunque el fichero ya venga ordenado: quien lee confía en
    // el orden y en que no haya repetidos, y eso no se delega en quien escribió.
    series.set(key, mergeRatingPoints(read));
  }
  return { seasonId: json.season, shard: json.shard, series };
}

/** Lo que queda de un personaje en un bracket de una temporada cerrada (ADR 0042). */
export interface ClosedSeasonStanding {
  bracket: string;
  /** La última observación de la temporada: el rating con el que se le vio por última vez. */
  last: RatingPoint;
  /** El máximo observado, no el máximo alcanzado: entre dos observaciones pudo subir más. */
  peak: number;
}

/**
 * Las series de un personaje en un shard, resumidas en su último punto y su
 * máximo, de mayor a menor rating final.
 *
 * Es lo que una ficha puede decir de una temporada que ya no está en Postgres:
 * el shard del índice guarda la serie entera, pero ni equipo, ni talentos, ni
 * partidas, así que esto es todo lo que hay y todo lo que se enseña.
 */
export function standingsInShard(
  shard: RatingHistoryShard,
  characterId: string,
): ClosedSeasonStanding[] {
  const prefix = seriesKey(characterId, "");
  const standings: ClosedSeasonStanding[] = [];
  for (const [key, points] of shard.series) {
    const last = points.at(-1);
    if (!key.startsWith(prefix) || !last) continue;
    standings.push({
      bracket: key.slice(prefix.length),
      last,
      peak: Math.max(...points.map((point) => point.rating)),
    });
  }
  return standings.sort(
    (a, b) => b.last.rating - a.last.rating || a.bracket.localeCompare(b.bracket),
  );
}
