/**
 * Catálogo canónico de specs: los slugs tal como los usa la API de Blizzard
 * para construir brackets de Solo Shuffle ("shuffle-{classSlug}-{specSlug}").
 *
 * Es la única fuente de verdad de esta correspondencia en todo el proyecto:
 * nunca se parsea un bracket partiendo el string por guiones, porque la
 * correspondencia no es mecánica — Blizzard aplasta los slugs compuestos
 * ("death-knight" → "deathknight"), así que de "shuffle-deathknight-frost" no se
 * recupera el classSlug partiendo por guiones. Siempre se resuelve contra este
 * catálogo (ver parseShuffleBracket).
 */
import type { SpecEntry } from "./types";

export const ALL_SPECS: readonly SpecEntry[] = [
  { classSlug: "death-knight", specSlug: "blood", label: "Blood Death Knight" },
  { classSlug: "death-knight", specSlug: "frost", label: "Frost Death Knight" },
  { classSlug: "death-knight", specSlug: "unholy", label: "Unholy Death Knight" },

  { classSlug: "demon-hunter", specSlug: "havoc", label: "Havoc Demon Hunter" },
  { classSlug: "demon-hunter", specSlug: "vengeance", label: "Vengeance Demon Hunter" },
  { classSlug: "demon-hunter", specSlug: "devourer", label: "Devourer Demon Hunter" },

  { classSlug: "druid", specSlug: "balance", label: "Balance Druid" },
  { classSlug: "druid", specSlug: "feral", label: "Feral Druid" },
  { classSlug: "druid", specSlug: "guardian", label: "Guardian Druid" },
  { classSlug: "druid", specSlug: "restoration", label: "Restoration Druid" },

  { classSlug: "evoker", specSlug: "devastation", label: "Devastation Evoker" },
  { classSlug: "evoker", specSlug: "preservation", label: "Preservation Evoker" },
  { classSlug: "evoker", specSlug: "augmentation", label: "Augmentation Evoker" },

  { classSlug: "hunter", specSlug: "beast-mastery", label: "Beast Mastery Hunter" },
  { classSlug: "hunter", specSlug: "marksmanship", label: "Marksmanship Hunter" },
  { classSlug: "hunter", specSlug: "survival", label: "Survival Hunter" },

  { classSlug: "mage", specSlug: "arcane", label: "Arcane Mage" },
  { classSlug: "mage", specSlug: "fire", label: "Fire Mage" },
  { classSlug: "mage", specSlug: "frost", label: "Frost Mage" },

  { classSlug: "monk", specSlug: "brewmaster", label: "Brewmaster Monk" },
  { classSlug: "monk", specSlug: "mistweaver", label: "Mistweaver Monk" },
  { classSlug: "monk", specSlug: "windwalker", label: "Windwalker Monk" },

  { classSlug: "paladin", specSlug: "holy", label: "Holy Paladin" },
  { classSlug: "paladin", specSlug: "protection", label: "Protection Paladin" },
  { classSlug: "paladin", specSlug: "retribution", label: "Retribution Paladin" },

  { classSlug: "priest", specSlug: "discipline", label: "Discipline Priest" },
  { classSlug: "priest", specSlug: "holy", label: "Holy Priest" },
  { classSlug: "priest", specSlug: "shadow", label: "Shadow Priest" },

  { classSlug: "rogue", specSlug: "assassination", label: "Assassination Rogue" },
  { classSlug: "rogue", specSlug: "outlaw", label: "Outlaw Rogue" },
  { classSlug: "rogue", specSlug: "subtlety", label: "Subtlety Rogue" },

  { classSlug: "shaman", specSlug: "elemental", label: "Elemental Shaman" },
  { classSlug: "shaman", specSlug: "enhancement", label: "Enhancement Shaman" },
  { classSlug: "shaman", specSlug: "restoration", label: "Restoration Shaman" },

  { classSlug: "warlock", specSlug: "affliction", label: "Affliction Warlock" },
  { classSlug: "warlock", specSlug: "demonology", label: "Demonology Warlock" },
  { classSlug: "warlock", specSlug: "destruction", label: "Destruction Warlock" },

  { classSlug: "warrior", specSlug: "arms", label: "Arms Warrior" },
  { classSlug: "warrior", specSlug: "fury", label: "Fury Warrior" },
  { classSlug: "warrior", specSlug: "protection", label: "Protection Warrior" },
];

/**
 * Bracket de Solo Shuffle tal como lo espera la API: "shuffle-mage-frost".
 *
 * Los guiones internos de los slugs se eliminan, porque así los nombra Blizzard:
 * "shuffle-deathknight-frost", no "shuffle-death-knight-frost", y
 * "shuffle-hunter-beastmastery", no "...-beast-mastery". Verificado contra la
 * API en la temporada 41 — las formas con guion devuelven 404, no una lista
 * vacía. Afecta a 7 de las 40 specs (death knight, demon hunter y beast mastery).
 */
export function shuffleBracketId(spec: SpecEntry): string {
  const flat = (slug: string): string => slug.replaceAll("-", "");
  return `shuffle-${flat(spec.classSlug)}-${flat(spec.specSlug)}`;
}

/** Inverso de shuffleBracketId, resuelto contra el catálogo (nunca por split). */
export function parseShuffleBracket(bracket: string): SpecEntry | undefined {
  return ALL_SPECS.find((spec) => shuffleBracketId(spec) === bracket);
}

/**
 * Leaderboard agregado de Solo Shuffle: no es una spec, es la suma de todas.
 * Aparece en el índice de Blizzard junto a los brackets por spec, así que hay
 * que descontarlo antes de comparar el índice con el catálogo.
 */
export const SHUFFLE_AGGREGATE_BRACKET = "shuffle-overall";

/**
 * Brackets de shuffle que Blizzard publica y el catálogo no sabe mapear.
 *
 * El catálogo es estático a propósito (es la fuente de verdad, versionada y
 * revisable), pero eso lo deja ciego ante una spec nueva de un parche: entraría
 * en el índice de Blizzard y el pipeline seguiría ingiriendo las de siempre sin
 * que nadie se enterara. Pasó de verdad — "shuffle-demonhunter-devourer" llevaba
 * 5.000 entradas publicadas y no estaba en ALL_SPECS.
 *
 * No decide nada por su cuenta: solo devuelve lo que no reconoce, para que quien
 * llame avise. Ingerir a ciegas un bracket que el catálogo no mapea rompería
 * parseShuffleBracket en la ingesta, que es peor que no ingerirlo.
 */
export function unknownShuffleBrackets(publishedBrackets: readonly string[]): string[] {
  const unknown = publishedBrackets.filter(
    (bracket) =>
      bracket.startsWith("shuffle-") &&
      bracket !== SHUFFLE_AGGREGATE_BRACKET &&
      parseShuffleBracket(bracket) === undefined,
  );
  return [...new Set(unknown)].sort();
}

/** Busca una spec por sus slugs. Devuelve undefined si no existe en el catálogo. */
export function findSpec(classSlug: string, specSlug: string): SpecEntry | undefined {
  return ALL_SPECS.find((s) => s.classSlug === classSlug && s.specSlug === specSlug);
}

/**
 * Igual que findSpec pero falla ruidosamente: para configuración estática
 * (listas de specs a ingerir), donde un slug mal escrito debe romper al
 * arrancar y no ingerir silenciosamente menos specs de las esperadas.
 */
export function requireSpec(classSlug: string, specSlug: string): SpecEntry {
  const spec = findSpec(classSlug, specSlug);
  if (!spec) {
    throw new Error(
      `Spec desconocida: "${classSlug}/${specSlug}". Revisa el catálogo ALL_SPECS en @wowpvp/core.`,
    );
  }
  return spec;
}

/** Clave estable para agrupar por spec en memoria/BD/URLs: "mage-frost". */
export function specKey(spec: SpecEntry): string {
  return `${spec.classSlug}-${spec.specSlug}`;
}
