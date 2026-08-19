/** Regiones soportadas por la API de Blizzard. El MVP lanza solo con "eu". */
export type Region = "eu" | "us" | "kr" | "tw";

/** Una especialización jugable, identificada como la nombra la API en los brackets. */
export interface SpecEntry {
  classSlug: string;
  specSlug: string;
  label: string;
}

/**
 * Un tramo de rating, semiabierto: [min, max). Semiabierto a propósito — un
 * jugador con exactamente 2000 pertenece a 2000-2200, nunca a los dos tramos.
 */
export interface RatingSegment {
  min: number;
  max: number;
  /** "1800-2000" — se usa como clave estable en BD y en URLs de SEO. */
  id: string;
}

/**
 * Nivel de confianza de una comparación, derivado del tamaño de muestra.
 * Ver docs/product-plan.md §13.4 y docs/decisions/0003-umbrales-de-confianza.md.
 */
export type ConfidenceLevel = "high" | "medium" | "insufficient";

/** Ventanas de actividad en días (docs/product-plan.md §27, "Active Players"). */
export type ActivityWindowDays = 7 | 14 | 30;

/**
 * Origen de un snapshot: entrada de leaderboard (barata), perfil completo
 * muestreado por nosotros (cara) o perfil traído por la búsqueda de un usuario.
 *
 * 'search' se distingue del resto porque entra por sesgo de selección —alguien
 * se interesó por ese personaje— y por eso queda fuera de los agregados por
 * segmento (ADR 0006 y ADR 0007), no porque el dato sea de peor calidad.
 */
export type SnapshotSource = "leaderboard" | "profile" | "search";
