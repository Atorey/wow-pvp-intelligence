import type { ActivityWindowDays, ConfidenceLevel } from "./types";

/**
 * Umbrales de confianza (docs/product-plan.md §13.4).
 *
 * Esta es una regla de PRODUCTO, no un detalle de presentación: por debajo de
 * MIN_SAMPLE_MEDIUM no se enseña la comparación, se enseña el motivo. Vive aquí,
 * en un único sitio compartido por pipeline y web, precisamente para que no
 * pueda "relajarse" en una capa y no en la otra.
 */
export const MIN_SAMPLE_HIGH = 100;
export const MIN_SAMPLE_MEDIUM = 30;

export function confidenceFor(sampleSize: number): ConfidenceLevel {
  if (sampleSize >= MIN_SAMPLE_HIGH) return "high";
  if (sampleSize >= MIN_SAMPLE_MEDIUM) return "medium";
  return "insufficient";
}

/**
 * Única puerta para decidir si una comparación puede mostrarse. Todo lo que
 * pinte un Player Gap pasa por aquí — nunca por un `if (n > algo)` suelto.
 */
export function canShowComparison(sampleSize: number): boolean {
  return confidenceFor(sampleSize) !== "insufficient";
}

/** Ventanas de actividad en días (docs/product-plan.md §27, "Active Players"). */
export const ACTIVITY_WINDOWS = {
  /** Por defecto para adoption_rate y Player Gap: máxima relevancia del meta actual. */
  default: 7,
  /** Alternativa cuando 7 días no da muestra suficiente: frescura a cambio de tamaño. */
  fallback: 14,
  /** "Season active": aparece en el ranking aunque no haya jugado esta semana. */
  seasonActive: 30,
} as const satisfies Record<string, ActivityWindowDays>;

export interface WindowChoice {
  window: ActivityWindowDays;
  sampleSize: number;
  confidence: ConfidenceLevel;
}

/**
 * Elige la ventana de actividad más fresca que alcance muestra suficiente:
 * 7 días si llega, si no 14. Nunca sube a 30 para un Player Gap — 30 días es
 * ventana de "season active" (ranking), no de meta actual; usarla para una
 * comparación mezclaría metas de parches distintos.
 *
 * Si ninguna llega al mínimo, devuelve la de 14 días con confianza
 * "insufficient": el llamante debe explicar por qué no hay comparación, no
 * inventarse una.
 */
export function pickActivityWindow(sampleSizeByWindow: { 7: number; 14: number }): WindowChoice {
  const sevenDay = sampleSizeByWindow[7];
  if (confidenceFor(sevenDay) !== "insufficient") {
    return { window: 7, sampleSize: sevenDay, confidence: confidenceFor(sevenDay) };
  }
  const fourteenDay = sampleSizeByWindow[14];
  return { window: 14, sampleSize: fourteenDay, confidence: confidenceFor(fourteenDay) };
}
