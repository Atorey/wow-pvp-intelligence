import { getRegion } from "@wowpvp/blizzard";
import type { Region } from "@wowpvp/core";
import { connection } from "next/server";

import { cachedRunPopulation } from "./aggregate-cache";
import { getDb } from "./db";
import "./env";
import { representationFor, type RepresentationBoard } from "./home-view";
import { logServerEvent } from "./log";

/**
 * Lo que la portada necesita de Postgres.
 *
 * Es una sola lectura, y es la que ya piden las páginas de spec: la población de
 * todos los brackets de la última corrida, que la caché de proceso recuerda
 * hasta la siguiente (ADR 0031). La portada no añade consulta ninguna, solo se
 * suma a una que ya estaba.
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

export interface HomeData {
  scope: HomeScope;
  meta: MetaBlock;
}

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
    };
  } catch (error) {
    logServerEvent("home-meta-unavailable", {
      reason: error instanceof Error ? error.message : String(error),
    });
    return { scope: { region, seasonId: null }, meta: { state: "unavailable" } };
  }
}
