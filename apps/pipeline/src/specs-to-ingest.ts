import { ALL_SPECS, type SpecEntry } from "@wowpvp/core";

/**
 * Specs que el pipeline descarga hoy: todas las del catálogo (#13).
 *
 * Empezamos por 3 populares en Sprint 0 para validar la tubería, no porque el
 * resto no interesara. Ya validada, la selección activa deja de tener sentido
 * como lista aparte: cualquier spec fuera de ella es un segmento de rating que
 * el producto no puede comparar, y las specs de tanque —con poblaciones de
 * cientos, no de miles— son justo las que necesitan que la ingesta lleve más
 * tiempo acumulando para llegar a n=30.
 *
 * Sigue siendo una constante propia del pipeline y no un alias de ALL_SPECS a
 * secas: es el punto donde acotar la ingesta si alguna vez hace falta (una spec
 * que Blizzard deja de publicar, una región nueva con menos presupuesto), y ese
 * recorte no debe tocar el catálogo canónico.
 */
export const SPECS_TO_INGEST: readonly SpecEntry[] = ALL_SPECS;
