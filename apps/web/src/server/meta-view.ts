import {
  DEFAULT_SEGMENT_SCALE,
  isLeaderboardCapped,
  segmentFor,
  type ArenaBracket,
  type RatingSegment,
} from "@wowpvp/core";
import type { RunPopulationRead } from "@wowpvp/data";

/**
 * Qué enseña `/meta/{arena}`, decidido sin tocar la base de datos.
 *
 * **Sin reparto por spec** (ADR 0048). En arena la población de una spec es la
 * de quien tiene perfil en la ventana, y a quién se le baja el perfil lo decide
 * nuestro muestreo, no la modalidad: una tabla de specs ordenada por esa cifra
 * mediría el muestreo y se leería como el meta. Lo que sí se sostiene es la
 * población del bracket por tramo, partida en quien tiene spec conocida y quien
 * no, y las entradas del leaderboard que la acotan.
 */

/** Un tramo del bracket. */
export interface ArenaSegmentRow {
  segment: RatingSegment;
  /** Activos con spec conocida: la suma de las filas de spec del tramo. */
  withSpec: number;
  /**
   * Activos sin perfil en la ventana, que no están en ninguna spec. `null` es
   * que la corrida no lo dice (regla 5), no que no haya nadie.
   */
  withoutSpec: number | null;
}

export interface ArenaBoard {
  bracket: ArenaBracket;
  /** La corrida de la que salen todas las cifras. */
  computedAt: Date;
  /** De arriba abajo, que es como se lee una escalera. */
  rows: ArenaSegmentRow[];
  withSpec: number;
  /** `null` si algún tramo no lo dice: una suma con un hueco no es un total. */
  withoutSpec: number | null;
  /** Entradas de la publicación que vio la corrida, o `null` si no se sabe (ADR 0045). */
  leaderboardEntries: number | null;
  capped: boolean;
}

/**
 * La población de un bracket de arena en la corrida, o `null` si no tiene a
 * nadie: sin tramos no hay página, y se dice con palabras (§1.5 del brief).
 *
 * Cada tramo suma sus filas de spec, contadas con la ventana de cada una, y el
 * sin spec se cuenta con la más ancha de la corrida (migración 0028). No se
 * corrige: cada cifra dice la verdad sobre su ventana, y la página lo declara.
 */
export function arenaBoardFor(
  run: RunPopulationRead | null,
  bracket: ArenaBracket,
): ArenaBoard | null {
  const entry = run?.brackets.find((candidate) => candidate.bracket === bracket);
  if (!run || !entry) return null;

  const rows = entry.segments
    .map((row) => ({
      segment: segmentFor(row.segmentMin, DEFAULT_SEGMENT_SCALE),
      withSpec: row.population,
      withoutSpec: row.withoutSpec,
    }))
    .filter((row) => row.withSpec + (row.withoutSpec ?? 0) > 0)
    .sort((a, b) => b.segment.min - a.segment.min);
  if (rows.length === 0) return null;

  return {
    bracket,
    computedAt: run.computedAt,
    rows,
    withSpec: rows.reduce((sum, row) => sum + row.withSpec, 0),
    withoutSpec: rows.some((row) => row.withoutSpec === null)
      ? null
      : rows.reduce((sum, row) => sum + (row.withoutSpec ?? 0), 0),
    leaderboardEntries: entry.leaderboardEntries,
    capped: isLeaderboardCapped(entry.leaderboardEntries),
  };
}
