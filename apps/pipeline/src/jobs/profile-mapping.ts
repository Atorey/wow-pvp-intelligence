/**
 * Traducción de las respuestas de Blizzard a las filas que guardamos.
 *
 * Está aparte del job y sin dependencias de red ni de BD a propósito: es la
 * parte con reglas de negocio de verdad (qué loadout es el bueno, qué cuenta
 * como "no disponible") y es la única que se puede probar sin API ni Postgres.
 */
import type { SpecEntry } from "@wowpvp/core";

// --- Formas de la API que nos interesan (parcial: solo lo que consumimos) ---

export interface EquipmentResponse {
  equipped_items?: {
    slot?: { type?: string };
    item?: { id?: number };
    name?: string;
    level?: { value?: number };
    quality?: { type?: string };
    enchantments?: { enchantment_id?: number }[];
    sockets?: { item?: { id?: number } }[];
    bonus_list?: number[];
  }[];
}

export interface SpecializationsResponse {
  specializations?: {
    specialization?: { name?: string };
    loadouts?: { is_active?: boolean; talent_loadout_code?: string }[];
  }[];
}

export interface ProfileResponse {
  average_item_level?: number;
  equipped_item_level?: number;
}

export interface PvpBracketResponse {
  rating?: number;
  season_match_statistics?: { played?: number; won?: number; lost?: number };
  tier?: { id?: number };
}

// --- Gear ---

/** Una fila de character_snapshot_gear, aún sin snapshot_id. */
export interface GearRow {
  slot: string;
  itemId: number;
  itemName: string | null;
  itemLevel: number | null;
  quality: string | null;
  enchantmentIds: number[];
  gemItemIds: number[];
  bonusList: number[];
}

function numbers(values: readonly (number | undefined)[] | undefined): number[] {
  return (values ?? []).filter((v): v is number => typeof v === "number");
}

/**
 * Items equipados → filas de gear, una por slot.
 *
 * Un item sin slot o sin id no se puede guardar (ambas columnas son not null),
 * así que se descarta en vez de inventarle un valor. Los arrays van vacíos, no
 * nulos: "este item no lleva gemas" es un hecho observado, distinto de "no
 * sabemos qué lleva" (regla 5), y la columna es `not null default '{}'`.
 */
export function mapEquipment(equipment: EquipmentResponse): GearRow[] {
  const bySlot = new Map<string, GearRow>();

  for (const item of equipment.equipped_items ?? []) {
    const slot = item.slot?.type;
    const itemId = item.item?.id;
    if (!slot || typeof itemId !== "number") continue;

    // La PK es (snapshot_id, slot): si la API repitiera un slot, el insert
    // fallaría entero. Nos quedamos con la primera aparición.
    if (bySlot.has(slot)) continue;

    bySlot.set(slot, {
      slot,
      itemId,
      itemName: item.name ?? null,
      itemLevel: item.level?.value ?? null,
      quality: item.quality?.type ?? null,
      enchantmentIds: numbers((item.enchantments ?? []).map((e) => e.enchantment_id)),
      gemItemIds: numbers((item.sockets ?? []).map((s) => s.item?.id)),
      bonusList: numbers(item.bonus_list),
    });
  }

  return [...bySlot.values()];
}

// --- Talentos ---

/**
 * Por qué un `talent_loadout_code` acabó siendo null. Todos los casos dejan la
 * columna a null, pero solo `no-code` es el riesgo del parche 11.2 (§30): que la
 * API responda bien y aun así no traiga el código. Mezclarlos en un único
 * "no disponible" borraría justo el dato que este muestreo viene a medir.
 *
 * `api-error` es aparte y no lo decide esta función: que el endpoint no
 * respondiera no dice nada sobre los talentos del personaje, así que no puede
 * contarse ni a favor ni en contra de la cobertura.
 */
export type TalentOutcome = "ok" | "spec-not-listed" | "no-loadout" | "no-code" | "api-error";

export interface TalentResult {
  code: string | null;
  outcome: TalentOutcome;
}

/** "Beast Mastery" → "beast-mastery", para casar el nombre de la API con nuestro specSlug. */
export function specNameToSlug(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

/**
 * Código de talentos de la spec **del bracket muestreado**, no de la que el
 * personaje tenga activa ahora.
 *
 * Un Frost Mage del leaderboard puede estar hoy en Fire: coger el loadout activo
 * sin comprobar la spec metería la build equivocada en el análisis del segmento.
 * Dentro de esa spec sí se prefiere el loadout activo, y si no hay ninguno
 * marcado, el primero que traiga código.
 */
export function findTalentLoadout(
  specializations: SpecializationsResponse,
  spec: SpecEntry,
): TalentResult {
  const entry = (specializations.specializations ?? []).find(
    (s) => s.specialization?.name && specNameToSlug(s.specialization.name) === spec.specSlug,
  );
  if (!entry) return { code: null, outcome: "spec-not-listed" };

  const loadouts = entry.loadouts ?? [];
  if (loadouts.length === 0) return { code: null, outcome: "no-loadout" };

  const withCode = loadouts.filter(
    (l) => typeof l.talent_loadout_code === "string" && l.talent_loadout_code.length > 0,
  );
  if (withCode.length === 0) return { code: null, outcome: "no-code" };

  const chosen = withCode.find((l) => l.is_active) ?? withCode[0];
  return { code: chosen?.talent_loadout_code ?? null, outcome: "ok" };
}
