import { getArenaBrackets } from "@wowpvp/blizzard";
import { BRACKET_SLUGS, isArenaSlug, type BracketSlug, type SpecRoute } from "@wowpvp/core";

import "./env";

/**
 * Las modalidades que la web enseña: Solo Shuffle siempre, y la arena que el
 * pipeline ingiere.
 *
 * El catálogo de `packages/core` dice qué rutas **sabe** construir el sitio; esto
 * dice cuáles tienen datos detrás. Es la misma variable que leen el leaderboard,
 * los perfiles y los agregados (`BLIZZARD_ARENA_BRACKETS`, ADR 0048) porque una
 * web que publicase 3v3 con el interruptor apagado tendría páginas vacías y un
 * copy que diría que el sitio lee algo que no lee.
 */
export function publishedBrackets(): readonly BracketSlug[] {
  const arena = new Set<string>(getArenaBrackets());
  return BRACKET_SLUGS.filter((slug) => !isArenaSlug(slug) || arena.has(slug));
}

export function isPublishedBracket(slug: BracketSlug): boolean {
  return publishedBrackets().includes(slug);
}

/**
 * Si la modalidad de una ruta de spec está publicada. Sin modalidad la ruta es
 * la de spec a secas, que enseña Solo Shuffle y existe siempre.
 */
export function isRouteBracketPublished(route: SpecRoute): boolean {
  return route.bracket === undefined || isPublishedBracket(route.bracket);
}
