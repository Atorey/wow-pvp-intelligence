import { requireSpec, type SpecEntry } from "@wowpvp/core";

/**
 * Specs que el pipeline descarga hoy. Empezamos por 3 populares (decisión del
 * plan §32, días 3-5) y se amplía desde aquí — el catálogo completo de las ~39
 * specs vive en @wowpvp/core (ALL_SPECS), esto es solo la selección activa.
 *
 * requireSpec falla al arrancar si un slug está mal escrito, en vez de ingerir
 * en silencio menos specs de las que crees.
 */
export const SPECS_TO_INGEST: SpecEntry[] = [
  requireSpec("mage", "frost"),
  requireSpec("shaman", "restoration"),
  requireSpec("warrior", "fury"),
];
