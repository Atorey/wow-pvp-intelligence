/**
 * El vocabulario de slots de equipo, en el orden en que se enseña.
 *
 * Los nombres son los de Blizzard tal cual llegan en `item.slot.type` y tal cual
 * se guardan en `character_snapshot_gear.slot`: no se traducen ni se renombran
 * aquí, porque son la clave con la que se cuenta el `adoption_rate` por slot y
 * dos vocabularios para lo mismo acabarían contando dos poblaciones distintas.
 * Cómo se escribe cada uno en pantalla es copy, y vive en los diccionarios de la
 * web —"Cabeza" y "Head" son la misma fila.
 *
 * El orden es el de la ficha de personaje del juego, que es el que el jugador ya
 * sabe recorrer, y vive aquí y no en el componente que pinta la lista porque el
 * pipeline lo necesita igual el día que ordene una comparación por slot.
 */
export const GEAR_SLOTS = [
  "HEAD",
  "NECK",
  "SHOULDER",
  "BACK",
  "CHEST",
  "WRIST",
  "HANDS",
  "WAIST",
  "LEGS",
  "FEET",
  "FINGER_1",
  "FINGER_2",
  "TRINKET_1",
  "TRINKET_2",
  "MAIN_HAND",
  "OFF_HAND",
  // Los dos cosméticos van al final y no fuera: no tienen item level ni entran
  // en ninguna comparación, pero son parte de lo que se observó y esconderlos
  // sería decidir por el jugador qué de su equipo cuenta como equipo.
  "SHIRT",
  "TABARD",
] as const;

export type GearSlot = (typeof GEAR_SLOTS)[number];

export function isGearSlot(value: string): value is GearSlot {
  return (GEAR_SLOTS as readonly string[]).includes(value);
}

/**
 * Comparador de slots para ordenar lo observado.
 *
 * Un slot que no esté en el catálogo **no se descarta**: se va al final, en
 * orden alfabético. Blizzard puede añadir uno mañana, y perder en silencio una
 * pieza que sí observamos es peor que enseñarla fuera de su sitio.
 */
export function compareGearSlots(a: string, b: string): number {
  const indexA = (GEAR_SLOTS as readonly string[]).indexOf(a);
  const indexB = (GEAR_SLOTS as readonly string[]).indexOf(b);
  if (indexA === -1 && indexB === -1) return a.localeCompare(b);
  if (indexA === -1) return 1;
  if (indexB === -1) return -1;
  return indexA - indexB;
}

/**
 * Calidades de item que publica la API, en minúsculas porque así se nombran los
 * tokens de color del sistema visual. `HEIRLOOM` no aparece en PvP y aun así
 * está: el conjunto es el de Blizzard, no el de lo que hemos visto hasta hoy.
 */
export const ITEM_QUALITIES = [
  "poor",
  "common",
  "uncommon",
  "rare",
  "epic",
  "legendary",
  "artifact",
  "heirloom",
] as const;

export type ItemQuality = (typeof ITEM_QUALITIES)[number];

/**
 * La calidad tal como llega de la columna (`'EPIC'`), normalizada al vocabulario
 * de los tokens. `null` es "no disponible" (regla 5): quien la pinte no debe
 * adivinar una calidad, solo prescindir del tinte.
 */
export function parseItemQuality(value: string | null | undefined): ItemQuality | null {
  if (!value) return null;
  const lower = value.toLowerCase();
  return (ITEM_QUALITIES as readonly string[]).includes(lower) ? (lower as ItemQuality) : null;
}
