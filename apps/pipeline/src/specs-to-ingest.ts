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

/**
 * Patrón `like` de los brackets de Solo Shuffle, los únicos cuya spec nombra el
 * propio bracket.
 *
 * La arena se ingiere desde el ADR 0048, pero sus filas de leaderboard no
 * tienen spec. Las consultas que todavía no saben darle una filtran con esto: sin
 * el filtro, `refresh-aggregates` etiquetaría el bracket `3v3` con la spec de su
 * primer miembro. `refresh-profiles` la mete aparte, nombrando los brackets de
 * arena encendidos, porque su spec la pone el perfil (ADR 0049). Filtrar en la
 * consulta, y no después, es además lo que evita bajar de Postgres filas que
 * nadie va a usar.
 */
export const SHUFFLE_BRACKETS_LIKE = "shuffle-%";
