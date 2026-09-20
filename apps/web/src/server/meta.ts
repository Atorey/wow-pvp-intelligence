import { getRegion } from "@wowpvp/blizzard";
import type { BracketSlug, Region } from "@wowpvp/core";
import { connection } from "next/server";

import { cachedRunPopulation } from "./aggregate-cache";
import { getDb } from "./db";
import "./env";
import { ALL_SPEC_ROWS, representationFor, type RepresentationBoard } from "./home-view";

/**
 * Lo que `/meta/{modalidad}` necesita de Postgres (ADR 0038).
 *
 * Una sola lectura, y ninguna nueva: `readRunPopulation` es la que ya piden las
 * páginas de spec y la portada, recordada por la caché de proceso hasta que
 * entre la corrida siguiente (ADR 0031). La diferencia con la portada no está en
 * la consulta sino en el recorte — allí ocho filas, aquí las cuarenta—, y por eso
 * el reparto lo calcula la misma función.
 *
 * **El fallo de lectura no se atrapa aquí**, al revés que en la portada. Allí lo
 * que hay encima del bloque es el buscador, que funciona sin Postgres y es lo
 * caro de perder; aquí la lectura **es** la página, y un `/meta` que se pintara
 * con una tarjeta de disculpa sería una URL indexable sin contenido. Sube al
 * `error.tsx` de la rama, como en las páginas de spec.
 */

/** Dónde se sitúa lo que enseña la página. */
export interface MetaScope {
  region: Region;
  bracket: BracketSlug;
  /** La temporada de la última corrida, o `null` si la región no tiene ninguna. */
  seasonId: number | null;
}

export interface MetaData {
  scope: MetaScope;
  /**
   * El reparto, o `null` si la corrida no tiene a nadie en la modalidad.
   *
   * `null` es una página sin contenido y se dice con palabras, no con una tabla
   * vacía (§1.5 del brief). Es además lo que decide que no se indexe: una
   * dirección sin cifras es thin content (ADR 0029).
   */
  board: RepresentationBoard | null;
}

export async function loadMetaData(bracket: BracketSlug): Promise<MetaData> {
  // En petición y no al construir, como el resto de lo que lee agregados: lo que
  // se enseña es la corrida de esta madrugada, y el build de CI no tiene
  // secretos con los que abrir Postgres.
  await connection();

  const region = getRegion();
  const run = await cachedRunPopulation(getDb(), region);
  const board = representationFor(run, { limit: ALL_SPEC_ROWS });

  return { scope: { region, bracket, seasonId: run?.seasonId ?? null }, board };
}

/**
 * Si la página tiene contenido que indexar.
 *
 * Es la misma condición que la de pintarla —hay reparto o no lo hay—, y no una
 * regla de muestra como la de los escalones: lo que esta página enseña es el
 * reparto entero de la modalidad, que o está completo o no está. Un umbral por
 * spec dejaría fuera filas que aquí son contexto de las demás.
 *
 * Y aquí sí se atrapa el fallo, por lo mismo que en las rutas de spec:
 * `generateMetadata` corre fuera de todo boundary y una excepción suya se salta
 * el `error.tsx`. Sin poder leer, la respuesta es la de una página sin
 * contenido: no se indexa. El render vuelve a leer y ahí sí lo recoge el
 * boundary.
 */
export async function isMetaIndexable(bracket: BracketSlug): Promise<boolean> {
  try {
    const { board } = await loadMetaData(bracket);
    return board !== null;
  } catch {
    return false;
  }
}
