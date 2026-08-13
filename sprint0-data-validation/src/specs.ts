/**
 * Slugs de clase-spec tal como los usa la API de Blizzard para construir
 * brackets de Solo Shuffle: "shuffle-{classSlug}-{specSlug}".
 * Cobertura completa de las 13 clases de retail — útil para cuando el
 * pipeline real (Phase 1) necesite ingerir todas las specs, no solo las
 * 3-5 del Sprint 0.
 */
export interface SpecEntry {
  classSlug: string;
  specSlug: string;
  label: string;
}

export const ALL_SPECS: SpecEntry[] = [
  { classSlug: "death-knight", specSlug: "blood", label: "Blood Death Knight" },
  { classSlug: "death-knight", specSlug: "frost", label: "Frost Death Knight" },
  { classSlug: "death-knight", specSlug: "unholy", label: "Unholy Death Knight" },

  { classSlug: "demon-hunter", specSlug: "havoc", label: "Havoc Demon Hunter" },
  { classSlug: "demon-hunter", specSlug: "vengeance", label: "Vengeance Demon Hunter" },

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

export function shuffleBracketId(spec: SpecEntry): string {
  return `shuffle-${spec.classSlug}-${spec.specSlug}`;
}

/**
 * Selección para el Sprint 0 (días 3-5 del plan): 3-5 specs populares para
 * arrancar, no las 39 de golpe. Edita esta lista libremente.
 */
export const SPECS_TO_FETCH: SpecEntry[] = [
  ALL_SPECS.find((s) => s.classSlug === "mage" && s.specSlug === "frost")!,
  ALL_SPECS.find((s) => s.classSlug === "shaman" && s.specSlug === "restoration")!,
  ALL_SPECS.find((s) => s.classSlug === "warrior" && s.specSlug === "fury")!,
];
