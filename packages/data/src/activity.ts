import type { Region } from "@wowpvp/core";
import type { Queryable } from "./queryable";

/**
 * Cuánta gente distinta hay dentro de la ventana de actividad de una modalidad.
 *
 * Sale de `character_activity` y no de `character_snapshots`: desde el ADR 0009
 * los snapshots solo guardan la fila que cambia, así que contarlas mide cuántas
 * veces alguien se movió, no a cuánta gente hemos observado. Tampoco sale de
 * `population_segments`, que es lo que ya cachea la portada: allí cada escalón
 * se cuenta con **su** ventana —7 días o 14, según le llegara la muestra
 * (ADR 0007, punto 6)— y sumar los tramos daría un total de ventana mezclada.
 * Aquí la ventana es una sola y la pone quien llama.
 */

/** Personajes distintos observados con actividad en la ventana, y de qué está hecha. */
export interface ActiveCharactersRead {
  /**
   * Personajes **distintos**, no filas: `character_activity` lleva una por
   * personaje y bracket, así que quien juega dos specs de la misma modalidad
   * aparece dos veces y es una sola persona.
   */
  observed: number;
  /**
   * De ellos, a cuántos les hemos visto subir el contador de partidas entre dos
   * observaciones. Es la única parte de la cifra que demuestra que se jugó.
   */
  byDelta: number;
  /**
   * El resto: fechados en la primera vez que los vimos, que es la cota más
   * antigua defendible (en la lista no se entra sin haber jugado).
   *
   * Viaja separada y no fundida en el total porque su peso se mueve con el
   * histórico: recién arrancada una temporada es casi todo, y con semanas de
   * serie detrás es una minoría —4.108 de 38.015 en EU el 18 de septiembre de
   * 2026—. Un total sin este reparto promete lo mismo en los dos casos.
   */
  byFirstSeen: number;
}

interface ActiveCharactersRow {
  observed: number;
  by_delta: number;
}

/**
 * La población activa de una modalidad, contada por personajes distintos.
 *
 * `brackets` llega desde fuera y no se deduce aquí con un `like 'shuffle-%'`:
 * qué brackets forman una modalidad es catálogo, vive en `packages/core` y ya
 * tiene resolutores. Con un prefijo en la `where`, un bracket que Blizzard
 * publicara y nosotros no mapeáramos —pasó con `shuffle-demonhunter-devourer`—
 * entraría en el recuento sin que nadie lo decidiera, y `shuffle-overall`, que
 * es la suma de todos, lo duplicaría entero.
 *
 * `since` también llega hecho, por lo mismo: el largo de la ventana es
 * `ACTIVITY_WINDOWS` y el instante contra el que se mide es una decisión de
 * quien pinta. Esta capa no lee el reloj.
 */
export async function readActiveCharacters(
  db: Queryable,
  key: { region: Region; seasonId: number; brackets: readonly string[]; since: Date },
): Promise<ActiveCharactersRead> {
  // Sin brackets no hay consulta que hacer, y `any('{}')` devolvería cero de
  // todas formas: se ahorra la ida al pooler.
  if (key.brackets.length === 0) return { observed: 0, byDelta: 0, byFirstSeen: 0 };

  const { rows } = await db.query<ActiveCharactersRow>(
    // La región vive en `characters` y no en la actividad, así que el join no es
    // opcional: sin él se contarían todas las regiones juntas.
    //
    // El `bool_or` es lo que hace que la evidencia siga siendo por persona
    // después de agrupar: quien tiene delta en una spec y arranque en otra ha
    // jugado, y contarlo en los dos lados sumaría más gente de la que hay.
    `select count(*)::int as observed,
            count(*) filter (where played)::int as by_delta
       from (
            select a.character_id, bool_or(a.evidence = 'played-delta') as played
              from character_activity a
              join characters c on c.id = a.character_id
             where c.region = $1
               and a.season_id = $2
               and a.bracket = any($3::text[])
               and a.last_active_at >= $4
             group by a.character_id
            ) as active`,
    [key.region, key.seasonId, [...key.brackets], key.since],
  );

  const row = rows[0];
  // Un `count` siempre devuelve fila; el cero sale de la consulta, no de aquí.
  const observed = row?.observed ?? 0;
  const byDelta = row?.by_delta ?? 0;
  return { observed, byDelta, byFirstSeen: observed - byDelta };
}
