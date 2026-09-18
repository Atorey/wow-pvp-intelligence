import { BRACKET_LABELS } from "@wowpvp/core";

/**
 * Los nombres de las modalidades, en el orden en que el jugador las nombra.
 *
 * Están aquí y no en `packages/core` porque no son rutas ni conceptos del
 * dominio —de las cuatro que faltan no hay slug, ni bracket, ni fila— sino los
 * nombres del juego. Y están en un módulo propio, no dentro de la barra
 * lateral, desde que hay dos sitios que los enseñan: la lista de la barra y el
 * bloque de población de la portada. Con la lista copiada, una modalidad nueva
 * aparecería en uno de los dos y el sitio diría dos cosas distintas sobre qué
 * hay publicado.
 *
 * Solo la primera está publicada. Las otras cuatro **no son páginas que
 * falten**: el pipeline no ingiere sus leaderboards, así que de ellas no hay
 * dato ninguno.
 */
export const PUBLISHED_BRACKET = BRACKET_LABELS["solo-shuffle"];

export const BRACKET_NAMES = [PUBLISHED_BRACKET, "2v2", "3v3", "RBG", "BG Blitz"] as const;

/**
 * Se compara contra el nombre y no contra el índice: el orden de la lista es
 * una decisión de lectura y puede cambiar, y con `index === 0` un reordenado
 * dejaría publicada a la que estuviera arriba.
 */
export function isPublishedBracket(name: string): boolean {
  return name === PUBLISHED_BRACKET;
}
