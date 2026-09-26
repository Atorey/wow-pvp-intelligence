import { mergeRatingPoints, type RatingPoint } from "@wowpvp/core";

/**
 * Qué enseña la pestaña de histórico, decidido sin tocar ni Postgres ni Storage.
 *
 * La serie tiene dos mitades —lo caliente en Postgres y lo archivado en el
 * índice de Storage (ADR 0039)— y lo que aquí puede salir mal no es leerlas, es
 * pintar una sola como si fuera la temporada entera. `character_activity` sabe
 * cuántas observaciones se archivaron, así que se puede comprobar que el índice
 * las trae todas y decir cuántas faltan cuando no.
 */
export interface RatingHistoryView {
  /** La serie unida, en orden de fecha y sin repetidos. */
  points: RatingPoint[];
  /**
   * Observaciones archivadas que no están en `points`. `null` es la serie
   * entera; con un hueco, la línea no es la temporada y la página lo dice.
   */
  gap: {
    /**
     * `unreadable`: no se ha podido leer el índice —Storage sin configurar o
     * caído—. `unindexed`: se ha leído y le faltan puntos, que es lo que pasa
     * con lo archivado antes del backfill.
     */
    cause: "unreadable" | "unindexed";
    missing: number;
  } | null;
}

export function ratingHistoryFor(input: {
  hot: readonly RatingPoint[];
  /** Los puntos del índice para esta serie; `null` si no se pudieron leer. */
  archived: readonly RatingPoint[] | null;
  /** `character_activity.archived_observations`, o 0 si no hay fila. */
  archivedObservations: number;
}): RatingHistoryView {
  const { hot, archived, archivedObservations } = input;

  if (archived === null) {
    return {
      points: mergeRatingPoints(hot),
      gap: archivedObservations > 0 ? { cause: "unreadable", missing: archivedObservations } : null,
    };
  }

  // Solo cuenta lo que el índice aporta: un punto que también está caliente —el
  // pico, el ancla— no es una observación archivada recuperada, es la misma
  // fila que sigue en Postgres.
  const hotTimes = new Set(hot.map((point) => point.at.getTime()));
  const recovered = archived.filter((point) => !hotTimes.has(point.at.getTime())).length;
  const missing = archivedObservations - recovered;

  return {
    points: mergeRatingPoints(hot, archived),
    gap: missing > 0 ? { cause: "unindexed", missing } : null,
  };
}
