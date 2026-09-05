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
    /**
     * `display_string` es de dónde sale el nombre del encantamiento. La API no
     * publica uno aparte y tampoco media para la mayoría (#92), pero el texto
     * llega siempre: sin él, un encantamiento agregado sería un número.
     */
    enchantments?: { enchantment_id?: number; display_string?: string }[];
    /** Un socket sin `item` es un hueco sin engemar, que es una observación. */
    sockets?: { item?: { id?: number; name?: string } }[];
    bonus_list?: number[];
  }[];
}

/**
 * Un nodo seleccionado, tal como lo devuelve la API. El nombre viaja dentro del
 * tooltip y falta en algún nodo suelto: eso no invalida la selección, solo deja
 * la etiqueta sin resolver.
 */
interface SelectedTalent {
  id?: number;
  rank?: number;
  tooltip?: { talent?: { name?: string } };
}

export interface SpecializationsResponse {
  specializations?: {
    specialization?: { name?: string };
    /**
     * Los tres talentos PvP. Cuelgan de la spec y no del loadout, así que
     * existen también para specs que el personaje no lleva activas — a
     * diferencia del gear, que es uno solo.
     */
    pvp_talent_slots?: { selected?: { talent?: { id?: number; name?: string } } }[];
    loadouts?: {
      is_active?: boolean;
      talent_loadout_code?: string;
      selected_class_talents?: SelectedTalent[];
      selected_spec_talents?: SelectedTalent[];
      selected_hero_talents?: SelectedTalent[];
      selected_hero_talent_tree?: { id?: number; name?: string };
    }[];
  }[];
}

export interface ProfileResponse {
  average_item_level?: number;
  equipped_item_level?: number;
  // Identidad. El leaderboard ya la trae en cada entrada; en una búsqueda por
  // nombre el perfil es la única fuente, y es lo que permite reconciliar a un
  // personaje renombrado con la fila que ya teníamos.
  id?: number;
  name?: string;
  faction?: { type?: string };
  realm?: { slug?: string };
  character_class?: { name?: string };
  /** Spec equipada ahora mismo. Decide de qué bracket es el gear que devuelve la API. */
  active_spec?: { name?: string };
}

export interface PvpBracketResponse {
  /** Temporada del rating. season_id es not null en BD y no siempre lo sabemos por otra vía. */
  season?: { id?: number };
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
  /**
   * Nombres de los encantamientos, **paralelos por posición** a
   * `enchantmentIds`. Un null es "no disponible" (regla 5), no un encantamiento
   * sin nombre: los dos arrays se construyen en la misma pasada justamente para
   * que no puedan desalinearse.
   */
  enchantmentNames: (string | null)[];
  gemItemIds: number[];
  /** Nombres de las gemas, paralelos por posición a `gemItemIds`. */
  gemItemNames: (string | null)[];
  bonusList: number[];
}

function numbers(values: readonly (number | undefined)[] | undefined): number[] {
  return (values ?? []).filter((v): v is number => typeof v === "number");
}

/**
 * El nombre de un encantamiento, sacado de su `display_string`.
 *
 * La API no publica el nombre en un campo propio: viene dentro de una frase
 * hecha para un tooltip, con el prefijo "Enchanted: " y, cuando lo aplicó una
 * profesión con calidad, un marcador de icono del cliente del juego al final
 * (`|A:Professions-ChatIcon-Quality-Tier2:20:20|a`). Se quitan los dos: son
 * envoltorio de presentación de Blizzard, no parte del nombre.
 *
 * Lo que queda no siempre es un nombre — hay encantamientos cuyo display es su
 * efecto ("+41 Intellect & +115 Stamina")— y se guarda igual: es lo que la API
 * da para nombrar esa variable, y describirla por su id sería peor.
 */
export function enchantmentName(displayString: string | undefined): string | null {
  if (!displayString) return null;
  const text = displayString
    .replace(/^Enchanted:\s*/, "")
    .replace(/\|A:.*$/, "")
    .trim();
  return text === "" ? null : text;
}

/**
 * Ids y nombres de una lista, en dos arrays alineados.
 *
 * Las entradas sin id se caen —no hay nada que agregar sin id— y con ellas su
 * nombre, que es lo que mantiene la correspondencia por posición.
 */
function idsAndNames<T>(
  entries: readonly T[] | undefined,
  idOf: (entry: T) => number | undefined,
  nameOf: (entry: T) => string | null,
): { ids: number[]; names: (string | null)[] } {
  const ids: number[] = [];
  const names: (string | null)[] = [];
  for (const entry of entries ?? []) {
    const id = idOf(entry);
    if (typeof id !== "number") continue;
    ids.push(id);
    names.push(nameOf(entry));
  }
  return { ids, names };
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

    const enchantments = idsAndNames(
      item.enchantments,
      (e) => e.enchantment_id,
      (e) => enchantmentName(e.display_string),
    );
    const gems = idsAndNames(
      item.sockets,
      (s) => s.item?.id,
      (s) => s.item?.name ?? null,
    );

    bySlot.set(slot, {
      slot,
      itemId,
      itemName: item.name ?? null,
      itemLevel: item.level?.value ?? null,
      quality: item.quality?.type ?? null,
      enchantmentIds: enchantments.ids,
      enchantmentNames: enchantments.names,
      gemItemIds: gems.ids,
      gemItemNames: gems.names,
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

/** Una fila de character_snapshot_talents, aún sin snapshot_id. */
export interface TalentRow {
  /** Namespace del id: 'class' | 'spec' | 'hero' para nodos, 'pvp' para talentos PvP. */
  tree: "class" | "spec" | "hero" | "pvp";
  talentId: number;
  /** null = no disponible (regla 5). El nodo está observado; el nombre, no. */
  talentName: string | null;
  /** Puntos invertidos. null en 'pvp', que no tiene rangos. */
  rank: number | null;
}

/** El árbol de héroe elegido en un loadout. Una elección entre dos por spec. */
export interface HeroTreeRef {
  id: number;
  name: string;
}

export interface TalentResult {
  code: string | null;
  outcome: TalentOutcome;
  /**
   * Nodos del **mismo** loadout que produjo `code`, no de otro. Van juntos y no
   * en una función aparte precisamente por eso: quien elige el loadout ya
   * resuelve una regla que no se adivina (la spec del bracket, no la activa), y
   * duplicar esa elección acabaría dando un código y unos nodos que describen
   * builds distintas sin que nadie lo note (ADR 0026).
   *
   * Vacío cuando `outcome !== "ok"`.
   */
  talents: TalentRow[];
  /** null = la API no lo trajo (~8% de los loadouts), nunca "no eligió". */
  heroTree: HeroTreeRef | null;
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
  const empty = { talents: [] as TalentRow[], heroTree: null };

  const entry = findSpecEntry(specializations, spec);
  if (!entry) return { code: null, outcome: "spec-not-listed", ...empty };

  const loadouts = entry.loadouts ?? [];
  if (loadouts.length === 0) return { code: null, outcome: "no-loadout", ...empty };

  const withCode = loadouts.filter(
    (l) => typeof l.talent_loadout_code === "string" && l.talent_loadout_code.length > 0,
  );
  if (withCode.length === 0) return { code: null, outcome: "no-code", ...empty };

  const chosen = withCode.find((l) => l.is_active) ?? withCode[0];
  if (!chosen) return { code: null, outcome: "no-code", ...empty };

  const tree = chosen.selected_hero_talent_tree;
  return {
    code: chosen.talent_loadout_code ?? null,
    outcome: "ok",
    talents: [
      ...mapNodes(chosen.selected_class_talents, "class"),
      ...mapNodes(chosen.selected_spec_talents, "spec"),
      ...mapNodes(chosen.selected_hero_talents, "hero"),
    ],
    heroTree: typeof tree?.id === "number" && tree.name ? { id: tree.id, name: tree.name } : null,
  };
}

/**
 * Nodos de un árbol → filas. Un nodo sin `id` no se puede guardar (la columna es
 * not null) y se descarta; uno sin nombre sí entra, porque la selección está
 * observada aunque la etiqueta no llegue.
 */
function mapNodes(
  nodes: readonly SelectedTalent[] | undefined,
  tree: "class" | "spec" | "hero",
): TalentRow[] {
  const byId = new Map<number, TalentRow>();

  for (const node of nodes ?? []) {
    if (typeof node.id !== "number") continue;
    // La PK es (snapshot_id, tree, talent_id): un id repetido dentro del mismo
    // árbol haría fallar el insert entero. Se conserva la primera aparición.
    if (byId.has(node.id)) continue;

    byId.set(node.id, {
      tree,
      talentId: node.id,
      talentName: node.tooltip?.talent?.name ?? null,
      rank: typeof node.rank === "number" ? node.rank : null,
    });
  }

  return [...byId.values()];
}

/**
 * Talentos PvP de la spec del bracket.
 *
 * Aparte de `findTalentLoadout` porque cuelgan de la spec y no del loadout, y
 * porque su "no disponible" es otro: la API los omite en ~12% de las entradas
 * de spec sin que eso diga nada del loadout. Por eso `null` y no `[]` — un array
 * vacío diría "los miramos y no lleva ninguno", que es lo que la regla 5 prohíbe
 * confundir con no haberlos podido mirar.
 */
export function mapPvpTalents(
  specializations: SpecializationsResponse,
  spec: SpecEntry,
): TalentRow[] | null {
  const slots = findSpecEntry(specializations, spec)?.pvp_talent_slots;
  if (!slots || slots.length === 0) return null;

  const byId = new Map<number, TalentRow>();
  for (const slot of slots) {
    const talent = slot.selected?.talent;
    if (typeof talent?.id !== "number") continue;
    if (byId.has(talent.id)) continue;

    // El slot_number no se guarda: la adopción es "lleva este talento PvP", y el
    // hueco no forma parte de su identidad — lo mismo que hace `slotGroup` al
    // no separar TRINKET_1 de TRINKET_2 (ADR 0026).
    byId.set(talent.id, {
      tree: "pvp",
      talentId: talent.id,
      talentName: talent.name ?? null,
      rank: null,
    });
  }

  return byId.size === 0 ? null : [...byId.values()];
}

function findSpecEntry(specializations: SpecializationsResponse, spec: SpecEntry) {
  return (specializations.specializations ?? []).find(
    (s) => s.specialization?.name && specNameToSlug(s.specialization.name) === spec.specSlug,
  );
}
