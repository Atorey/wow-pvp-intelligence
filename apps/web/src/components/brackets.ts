import { BRACKET_LABELS, type BracketSlug } from "@wowpvp/core";

/**
 * Las modalidades del juego, en el orden en que el jugador las nombra.
 *
 * Están aquí y no en `packages/core` porque la lista no es de rutas: RBG y BG
 * Blitz son nombres del juego sin slug, ni bracket, ni fila. Y están en un
 * módulo propio, no dentro de la barra lateral, porque hay tres sitios que las
 * enseñan —la barra, el bloque de población de la portada y el perfil— y con la
 * lista copiada una modalidad nueva aparecería en uno y no en los otros.
 *
 * Qué está publicado no se decide aquí: lo dice `publishedBrackets()`, que lee
 * el mismo interruptor de arena que el pipeline (ADR 0048). Una modalidad sin
 * slug **no es una página que falte**: el pipeline no ingiere su leaderboard, así
 * que de ella no hay dato ninguno.
 */
export interface BracketName {
  name: string;
  /** La modalidad de la ruta, o `null` si el sitio no sabe publicarla. */
  slug: BracketSlug | null;
}

export const BRACKETS: readonly BracketName[] = [
  { name: BRACKET_LABELS["solo-shuffle"], slug: "solo-shuffle" },
  { name: BRACKET_LABELS["2v2"], slug: "2v2" },
  { name: BRACKET_LABELS["3v3"], slug: "3v3" },
  { name: "RBG", slug: null },
  { name: "BG Blitz", slug: null },
];

export function isPublished(
  entry: BracketName,
  published: readonly BracketSlug[],
): entry is BracketName & { slug: BracketSlug } {
  return entry.slug !== null && published.includes(entry.slug);
}

/** Los nombres de lo que el sitio lee, en el orden de la lista. */
export function readBracketNames(published: readonly BracketSlug[]): string[] {
  return BRACKETS.filter((entry) => isPublished(entry, published)).map((entry) => entry.name);
}

/** Y los de lo que no lee, que se nombran para que su ausencia no parezca un olvido. */
export function unreadBracketNames(published: readonly BracketSlug[]): string[] {
  return BRACKETS.filter((entry) => !isPublished(entry, published)).map((entry) => entry.name);
}
