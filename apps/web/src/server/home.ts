import { getRegion } from "@wowpvp/blizzard";
import {
  ACTIVITY_WINDOWS,
  ALL_SPECS,
  activityWindowStart,
  shuffleBracketId,
  type ActivityWindowDays,
  type Region,
} from "@wowpvp/core";
import type { ActiveCharactersRead, RunPopulationRead } from "@wowpvp/data";
import { connection } from "next/server";

import { cachedActiveCharacters, cachedRunPopulation } from "./aggregate-cache";
import { getDb } from "./db";
import "./env";
import { representationFor, type RepresentationBoard } from "./home-view";
import { logServerEvent } from "./log";

/**
 * Lo que la portada necesita de Postgres.
 *
 * Dos lecturas. La primera es la que ya piden las páginas de spec: la población
 * de todos los brackets de la última corrida, que la caché de proceso recuerda
 * hasta la siguiente (ADR 0031). La segunda es propia del bloque de población y
 * cuenta personajes distintos dentro de la ventana de actividad, que es lo que
 * la suma de escalones no puede dar: cada escalón se cuenta con su propia
 * ventana, y un personaje con dos specs está en dos escalones.
 */

/** Dónde se sitúa lo que enseña la portada. */
export interface HomeScope {
  region: Region;
  /** La temporada de la última corrida, o `null` si la región no tiene ninguna. */
  seasonId: number | null;
}

/**
 * Los tres estados del bloque, que son tres cosas distintas y se dicen distinto
 * (§1.5 del brief): hay reparto que enseñar, la corrida no tiene a nadie en la
 * modalidad, o la lectura no se ha podido hacer.
 */
export type MetaBlock =
  { state: "listed"; board: RepresentationBoard } | { state: "empty" } | { state: "unavailable" };

/**
 * Los mismos tres estados para el bloque de población, y por la misma razón: no
 * hay nadie dentro de la ventana, o no se ha podido mirar.
 */
export type PopulationBlock =
  | {
      state: "counted";
      active: ActiveCharactersRead;
      /** De qué corrida es la cifra: la misma que fecha el bloque de arriba. */
      computedAt: Date;
      /** Cuántos días abarca la ventana, para escribirlo donde se afirma. */
      windowDays: ActivityWindowDays;
    }
  | { state: "empty" }
  | { state: "unavailable" };

export interface HomeData {
  scope: HomeScope;
  meta: MetaBlock;
  population: PopulationBlock;
}

/**
 * Los brackets que forman Solo Shuffle, resueltos contra el catálogo.
 *
 * Se arma aquí y no en la `where` de la lectura: `shuffle-overall` es la suma de
 * todas las specs y duplicaría la modalidad entera, y una spec que Blizzard
 * publique y el catálogo no mapee —pasó con `shuffle-demonhunter-devourer`— no
 * entra en un recuento sin que alguien lo decida.
 */
const SHUFFLE_BRACKETS = ALL_SPECS.map(shuffleBracketId);

/**
 * El reparto de la modalidad para la portada.
 *
 * **Aquí sí se atrapa el fallo de lectura**, al revés que en las páginas de
 * spec, y no es una inconsistencia: lo que hay encima de este bloque es el
 * buscador, que es la única puerta al producto (§23) y no necesita Postgres
 * para funcionar. Dejar subir la excepción cambiaría un bloque sin cifras por
 * una portada entera caída. Lo que no se hace es disimular: el estado tiene su
 * propio texto, porque "no se ha podido leer" no es "no hay nadie".
 */
export async function loadHomeData(): Promise<HomeData> {
  // En petición y no al construir, como las páginas de spec: lo que se enseña
  // es la corrida de esta madrugada, y el build de CI no tiene secretos con los
  // que abrir Postgres.
  await connection();

  const region = getRegion();

  try {
    const run = await cachedRunPopulation(getDb(), region);
    const board = representationFor(run);

    return {
      scope: { region, seasonId: run?.seasonId ?? null },
      meta: board ? { state: "listed", board } : { state: "empty" },
      population: await loadPopulation(region, run),
    };
  } catch (error) {
    logServerEvent("home-data-unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return {
      scope: { region, seasonId: null },
      meta: { state: "unavailable" },
      population: { state: "unavailable" },
    };
  }
}

/**
 * Cuánta gente distinta hay en la modalidad dentro de la ventana de actividad.
 *
 * La ventana se mide contra el `computed_at` de la corrida y no contra el reloj
 * de la visita. `refresh-aggregates` reconstruye `character_activity` al empezar
 * y escribe los escalones después, con el mismo instante, así que los 7 días
 * anteriores a esa fecha son exactamente los que la tabla tiene contados. Con
 * `Date.now()` la cifra se movería entre dos visitas sin que hubiera entrado un
 * dato nuevo, y no casaría con la fecha que la propia portada declara debajo.
 *
 * Sin corrida no hay ni temporada que contar ni fecha contra la que medir: eso
 * es `empty`, lo mismo que dice el bloque de arriba.
 */
async function loadPopulation(
  region: Region,
  run: RunPopulationRead | null,
): Promise<PopulationBlock> {
  if (!run) return { state: "empty" };

  const windowDays = ACTIVITY_WINDOWS.default;
  const active = await cachedActiveCharacters(getDb(), {
    region,
    seasonId: run.seasonId,
    brackets: SHUFFLE_BRACKETS,
    computedAt: run.computedAt,
    since: activityWindowStart(run.computedAt, windowDays),
  });

  // Cero observados no es una cifra que enseñar, es la ausencia de población: se
  // dice con palabras, como manda la §1.5 del brief.
  if (active.observed === 0) return { state: "empty" };
  return { state: "counted", active, computedAt: run.computedAt, windowDays };
}
