import type { ItemQuality } from "@wowpvp/core";

/**
 * El color de calidad de item, como utilidades de Tailwind.
 *
 * Misma decisión y mismas razones que [`class-color.ts`](./class-color.ts): los
 * valores viven en `globals.css` con su contraste verificado, y la
 * correspondencia se escribe **entera y a mano** porque Tailwind lee el código
 * como texto y un `text-quality-${quality}` no generaría ninguna utilidad.
 *
 * El tinte nunca es el único portador de nada: el nombre del item es la
 * información y esto la acompaña. Quien no distinga el morado del azul recibe
 * exactamente el mismo dato.
 */
interface QualityColor {
  /** El nombre del item. */
  readonly text: string;
  /** El borde del hueco del icono. */
  readonly border: string;
}

const QUALITY_COLORS: Record<ItemQuality, QualityColor> = {
  poor: { text: "text-quality-poor", border: "border-quality-poor" },
  common: { text: "text-quality-common", border: "border-quality-common" },
  uncommon: { text: "text-quality-uncommon", border: "border-quality-uncommon" },
  rare: { text: "text-quality-rare", border: "border-quality-rare" },
  epic: { text: "text-quality-epic", border: "border-quality-epic" },
  legendary: { text: "text-quality-legendary", border: "border-quality-legendary" },
  artifact: { text: "text-quality-artifact", border: "border-quality-artifact" },
  // Heirloom no tiene token propio: no aparece en PvP y añadir un color al
  // sistema por un caso que no se ha visto sería un token que nadie verifica.
  heirloom: { text: "text-foreground", border: "border-input" },
};

/**
 * Lo que se pinta cuando la calidad no consta. `null` es "no disponible" (regla
 * 5 del proyecto): ni se le adivina una calidad al item ni se le apaga el
 * nombre, que es la información que sí tenemos.
 */
const UNKNOWN: QualityColor = { text: "text-foreground", border: "border-input" };

/**
 * Recibe la calidad **ya normalizada** y no el `'EPIC'` de la columna: quien la
 * traiga cruda tiene que pasar por `parseItemQuality()`, que es donde se decide
 * qué es una calidad y qué es un valor que no reconocemos.
 */
export function qualityColor(quality: ItemQuality | null | undefined): QualityColor {
  return quality ? QUALITY_COLORS[quality] : UNKNOWN;
}
