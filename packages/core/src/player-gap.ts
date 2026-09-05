/**
 * Player Gap: qué separa a un jugador del siguiente segmento de rating
 * (docs/product-plan.md §13).
 *
 * Todo lo que hay aquí es puro: recibe poblaciones ya cargadas y devuelve
 * números. Vive en core, y no en el job de pipeline, porque la web de Phase 2
 * (#18) tiene que calcular exactamente lo mismo — si la fórmula viviera en el
 * pipeline habría que duplicarla, que es justo el riesgo que ADR 0003 evita con
 * los umbrales de confianza.
 *
 * Lo que este módulo NO hace, y conviene tener presente al leer un reporte:
 *
 * - No aplica ventana de actividad (§27, "Active Players", pendiente en #16).
 *   La población es "lo que se muestreó", no "lo que está activo estos 7 días".
 * - No compara stats secundarias ni embellishments, que sí aparecen en el
 *   mockup de §13.1: el schema de hoy no guarda ni unas ni otros, y deducirlos
 *   por heurística sería inventar dato en la feature que promete no inventarlo.
 * - No compara talentos nodo a nodo, solo por coincidencia exacta de código.
 *   Los nodos ya se agregan y se publican por segmento (`aggregateTalentNodes`,
 *   ADR 0026); traerlos a esta comparación es #18.
 */
import { canShowComparison, confidenceFor } from "./confidence";
import { median } from "./stats";
import type { ConfidenceLevel, RatingSegment } from "./types";

/**
 * Slots que no se comparan. No son elecciones de rendimiento, así que su
 * adoption_rate sería ruido con apariencia de insight.
 */
export const COSMETIC_SLOTS: readonly string[] = ["TABARD", "SHIRT"];

/**
 * Slots intercambiables, normalizados a un grupo común.
 *
 * En WoW da igual qué anillo va en FINGER_1 y cuál en FINGER_2, y lo mismo con
 * los abalorios. Comparar por el slot literal parte la adopción del mismo item
 * entre dos slots y fabrica diferencias que no existen: en los primeros
 * reportes de #9, un mismo abalorio salía a la vez como "+16 puntos arriba" en
 * TRINKET_2 y "-11 puntos abajo" en TRINKET_1, que es puro artefacto del orden
 * en que la API devuelve el equipo.
 *
 * Un grupo se compara como conjunto: la pregunta es "¿lleva este item en alguno
 * de sus huecos de abalorio?", no "¿lo lleva en el segundo?".
 */
const SLOT_GROUPS: Readonly<Record<string, string>> = {
  TRINKET_1: "TRINKET",
  TRINKET_2: "TRINKET",
  FINGER_1: "FINGER",
  FINGER_2: "FINGER",
};

/** El grupo comparable de un slot. Los que no son intercambiables son su propio grupo. */
export function slotGroup(slot: string): string {
  return SLOT_GROUPS[slot] ?? slot;
}

/**
 * Diferencia mínima de adopción para que una variable se considere
 * discriminante (§13.3, adaptado).
 *
 * El plan define el poder discriminante como la varianza de adoption_rate entre
 * segmentos consecutivos, pero eso necesita tres segmentos o más para decir
 * algo: con dos, la varianza es una función monótona de |Δ| y no aporta
 * información nueva. Mientras solo haya dos segmentos muestreados se usa
 * directamente el delta, con un mínimo de 10 puntos porcentuales.
 *
 * El umbral es deliberadamente alto: por debajo de esto la diferencia es
 * indistinguible del ruido de muestreo con n=100, y §13.5 dice que las
 * diferencias pequeñas se ocultan, no se muestran "por completitud".
 *
 * Cuando haya tres segmentos, esta constante se sustituye por la varianza real
 * sin tocar a los llamantes: el filtro está encapsulado en isDiscriminative().
 */
export const MIN_DISCRIMINATIVE_DELTA = 0.1;

/** Cuántas diferencias de gear se listan como "biggest differences" (§13.1). */
export const DEFAULT_TOP_DIFFERENCES = 5;

/** Cuántos códigos de talentos del segmento objetivo se listan. */
export const DEFAULT_TOP_TALENT_CODES = 3;

/**
 * Un personaje reducido a lo que Player Gap compara.
 *
 * `gearBySlot` vacío significa "no pudimos leer su equipo", no "va desnudo":
 * esos perfiles salen del denominador de gear. Un slot ausente dentro de un
 * equipo que sí se leyó sí es un hecho observado (ese slot está vacío).
 */
export interface PlayerBuild {
  characterId: string;
  rating: number;
  /** item_id equipado por slot ('HEAD', 'TRINKET_1', ...). */
  gearBySlot: ReadonlyMap<string, number>;
  /** null = no disponible (regla 5 del proyecto), nunca "no lleva talentos". */
  talentLoadoutCode: string | null;
  /**
   * Nodos seleccionados del loadout de su spec. null = no pudimos leerlos, y ese
   * perfil sale del denominador de nodos; nunca "no lleva ninguno".
   *
   * Es la variable que sí agrupa: el código completo la lleva distinta casi cada
   * jugador, así que agregarlo describe personas y no escalones (ADR 0026).
   */
  talents: readonly TalentSelection[] | null;
  /** Árbol de héroe elegido. null = no disponible. */
  heroTalentTree: HeroTreeSelection | null;
  /**
   * Talentos PvP. Denominador propio y no compartido con `talents`: cuelgan de
   * la spec y no del loadout, y la API los omite en ~12% de las entradas de spec
   * por razones que no dicen nada del loadout (ADR 0026).
   */
  pvpTalents: readonly TalentSelection[] | null;
  /**
   * Gemas engarzadas en todo su equipo, sin el hueco del que salen.
   *
   * No es nullable, al revés que `talents`, y la diferencia no es un descuido:
   * las gemas salen de la misma fila que el item, así que su disponibilidad es
   * exactamente la del gear y la decide `hasComparableGear()`. Una lista vacía
   * dentro de un equipo legible es un hecho observado —no engemó nada—, no una
   * ausencia de dato, y por eso cuenta en el denominador con adopción 0.
   *
   * Van sin slot a propósito: la misma gema se pone en piezas distintas y la
   * pregunta es "¿la lleva?", no "¿en qué hueco?" (ADR 0027).
   */
  gems: readonly GearSelection[];
  /** Encantamientos aplicados, por la misma regla y con el mismo denominador. */
  enchantments: readonly GearSelection[];
  /**
   * Item level de lo que lleva puesto. Es el que se compara: `average_item_level`
   * cuenta también lo mejor que tenga en el banco y en las bolsas, que no es lo
   * que el jugador está usando en la arena. Difieren en más de la mitad de los
   * perfiles muestreados, así que la diferencia no es teórica.
   */
  equippedItemLevel: number | null;
  /** Se transporta como contexto, pero no entra en la comparación. */
  averageItemLevel: number | null;
}

/**
 * Una gema o un encantamiento observados.
 *
 * `name` a null es "no disponible" (regla 5), no "sin nombre": el id identifica
 * la variable y el nombre solo la etiqueta. Los snapshots anteriores a la
 * migración 0013 traen el id sin él, así que la adopción es correcta desde el
 * primer recálculo y la etiqueta se va rellenando.
 */
export interface GearSelection {
  id: number;
  name: string | null;
}

/** Un nodo de talento observado, ya resuelto: no hay nada que decodificar. */
export interface TalentSelection {
  /** Namespace del id: 'class' | 'spec' | 'hero' son nodos; 'pvp', talentos PvP. */
  tree: TalentTree;
  talentId: number;
  /** null = no disponible. La selección está observada; su etiqueta, no. */
  talentName: string | null;
}

export type TalentTree = "class" | "spec" | "hero" | "pvp";

/** El árbol de héroe elegido en un loadout: una elección entre dos por spec. */
export interface HeroTreeSelection {
  id: number;
  name: string;
}

/**
 * Un adoption_rate con su denominador a la vista (§13.2).
 *
 * El denominador se transporta junto al valor, y no se calcula al pintar,
 * porque §13.5 exige mostrar el tamaño de muestra pegado al porcentaje. Si el
 * llamante tuviera que recomponerlo, tarde o temprano alguien pintaría el % sin
 * él.
 */
export interface AdoptionRate {
  /** Proporción en [0,1]. 0 si el denominador es 0 — nunca NaN. */
  value: number;
  /** Cuántos miembros usan la variable. */
  users: number;
  /** Población con dato disponible: la base real del porcentaje. */
  denominator: number;
  /** Excluidos por dato no disponible. Se declara, no se esconde. */
  unavailable: number;
}

/**
 * adoption_rate de una variable sobre una población.
 *
 * `observe` devuelve `null` cuando el dato no está disponible para ese miembro,
 * y esa fila sale del denominador (regla 5): contar un `talent_loadout_code`
 * ausente como no-adopción falsearía el dato hacia abajo.
 */
export function adoptionRate<T>(
  population: readonly T[],
  observe: (member: T) => boolean | null,
): AdoptionRate {
  let users = 0;
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    const observed = observe(member);
    if (observed === null) {
      unavailable++;
      continue;
    }
    denominator++;
    if (observed) users++;
  }

  return {
    value: denominator === 0 ? 0 : users / denominator,
    users,
    denominator,
    unavailable,
  };
}

/**
 * Si una diferencia de adopción supera el mínimo para mostrarse (§13.3).
 *
 * Único punto donde se decide "esto discrimina": cambiar el criterio cuando
 * haya más segmentos es cambiar esta función, no buscar comparaciones sueltas.
 */
export function isDiscriminative(delta: number): boolean {
  return Math.abs(delta) >= MIN_DISCRIMINATIVE_DELTA;
}

// --- Gear ---

/** Si el equipo de este miembro es legible; si no, sale de los denominadores de gear. */
export function hasComparableGear(member: PlayerBuild): boolean {
  return member.gearBySlot.size > 0;
}

// --- Talentos ---

/**
 * Si los nodos de este miembro son legibles.
 *
 * A diferencia del gear, que usa "el mapa está vacío", aquí la ausencia es
 * `null` explícito: un personaje siempre lleva talentos, así que una lista vacía
 * no podría distinguirse de no haberla podido leer.
 */
export function hasComparableTalents(member: PlayerBuild): boolean {
  return member.talents !== null;
}

/** Denominador propio, por la razón del ADR 0026: falta por motivos distintos. */
export function hasComparablePvpTalents(member: PlayerBuild): boolean {
  return member.pvpTalents !== null;
}

/**
 * Los items de un miembro agrupados por slot comparable, sin los cosméticos.
 *
 * Un grupo puede tener más de un item (dos anillos, dos abalorios), por eso es
 * un Set y no un valor suelto.
 *
 * Exportada porque los agregados por segmento (#15) cuentan la misma adopción
 * en una sola pasada sobre la población: si allí se reagrupara el equipo con
 * otro criterio, el adoption_rate publicado y el que compara Player Gap
 * dejarían de ser el mismo número.
 */
export function comparableItemsByGroup(member: PlayerBuild): Map<string, Set<number>> {
  const groups = new Map<string, Set<number>>();
  for (const [slot, itemId] of member.gearBySlot) {
    if (COSMETIC_SLOTS.includes(slot)) continue;
    const group = slotGroup(slot);
    let items = groups.get(group);
    if (!items) {
      items = new Set<number>();
      groups.set(group, items);
    }
    items.add(itemId);
  }
  return groups;
}

/**
 * Slots comparables observados en una población, ya normalizados a grupo y en
 * orden estable.
 *
 * Se derivan de los datos y no de una lista fija de slots de WoW: si una
 * temporada añade o quita un slot, el análisis sigue funcionando sin tocar
 * código. El orden alfabético hace que dos ejecuciones den el mismo reporte.
 */
export function comparableSlotGroups(population: readonly PlayerBuild[]): string[] {
  const groups = new Set<string>();
  for (const member of population) {
    for (const group of comparableItemsByGroup(member).keys()) groups.add(group);
  }
  return [...groups].sort();
}

/**
 * adoption_rate de un item dentro de su grupo de slots: "qué proporción del
 * segmento lleva este item en alguno de esos huecos".
 */
export function slotItemAdoption(
  population: readonly PlayerBuild[],
  group: string,
  itemId: number,
): AdoptionRate {
  return adoptionRate(population, (member) =>
    hasComparableGear(member)
      ? (comparableItemsByGroup(member).get(group)?.has(itemId) ?? false)
      : null,
  );
}

/** El item más llevado de un grupo, o undefined si nadie de la población lo equipa. */
export function modalItem(
  population: readonly PlayerBuild[],
  group: string,
): { itemId: number; adoption: AdoptionRate } | undefined {
  const counts = new Map<number, number>();
  for (const member of population) {
    if (!hasComparableGear(member)) continue;
    for (const itemId of comparableItemsByGroup(member).get(group) ?? []) {
      counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
  }

  let best: number | undefined;
  let bestCount = 0;
  // Empate resuelto por item_id menor: arbitrario pero estable, para que el
  // mismo dataset dé siempre el mismo reporte.
  for (const [itemId, count] of [...counts].sort((a, b) => a[0] - b[0])) {
    if (count > bestCount) {
      best = itemId;
      bestCount = count;
    }
  }

  if (best === undefined) return undefined;
  return { itemId: best, adoption: slotItemAdoption(population, group, best) };
}

/**
 * El "% aligned" de gear del mockup de §13.1.
 *
 * Es la media, sobre los slots que el jugador lleva equipados, del
 * adoption_rate que ese item tiene en el segmento objetivo. Se lee como "tus
 * items los lleva de media el X% del segmento de arriba".
 *
 * No es el % de slots que coinciden con el item modal, que sería una métrica
 * binaria por slot: con items muy repartidos, "coincides con el modal en 3 de
 * 15 slots" suena a desastre aunque tus items estén entre los más llevados.
 * Promediar la adopción real es más honesto y no penaliza que el segmento
 * objetivo esté dividido entre varias opciones igual de buenas.
 *
 * Los slots que el jugador no lleva equipados no entran en la media: no se
 * puede medir la adopción de un item que no existe.
 */
export interface GearAlignment {
  /** Media de adopción en [0,1]. null si no hay ningún item comparable. */
  score: number | null;
  /** Items del jugador que entraron en la media (los dos anillos cuentan como dos). */
  comparedItems: number;
}

export function gearAlignment(
  player: PlayerBuild,
  targetPopulation: readonly PlayerBuild[],
): GearAlignment {
  const groups = new Set(comparableSlotGroups(targetPopulation));
  const playerItems = comparableItemsByGroup(player);
  let total = 0;
  let compared = 0;

  for (const [group, items] of playerItems) {
    if (!groups.has(group)) continue;
    for (const itemId of items) {
      total += slotItemAdoption(targetPopulation, group, itemId).value;
      compared++;
    }
  }

  return { score: compared === 0 ? null : total / compared, comparedItems: compared };
}

/**
 * Una diferencia de adopción entre el segmento del jugador y el de arriba.
 *
 * Se guardan los dos adoption_rate enteros, no solo el delta, porque el copy de
 * §13.6 necesita ambos porcentajes y ambos denominadores.
 */
export interface GearDifference {
  /** Slot comparable ya normalizado: 'TRINKET' y 'FINGER', no 'TRINKET_1'. */
  slotGroup: string;
  itemId: number;
  /** Adopción en el segmento objetivo. */
  target: AdoptionRate;
  /** Adopción en el segmento del jugador. */
  own: AdoptionRate;
  /** target - own, con signo: positivo = más llevado arriba. */
  delta: number;
  /** Si el jugador lleva ese item hoy. Es contexto, no un juicio. */
  playerHasIt: boolean;
}

/**
 * Las diferencias de gear más grandes entre los dos segmentos (§13.1,
 * "biggest differences").
 *
 * Los candidatos son los items que aparecen en el **segmento objetivo**: el
 * producto describe lo que lleva el escalón de arriba, no cataloga lo que lleva
 * el de abajo y falta arriba.
 *
 * Se ordenan por |delta| y se recorta a `top`, pero solo entre los que pasan el
 * filtro discriminante: si hay menos, la lista sale más corta. Nunca se rellena
 * con diferencias pequeñas para cuadrar el número (§13.5).
 */
export function biggestGearDifferences(
  player: PlayerBuild,
  ownPopulation: readonly PlayerBuild[],
  targetPopulation: readonly PlayerBuild[],
  top: number = DEFAULT_TOP_DIFFERENCES,
): GearDifference[] {
  const differences: GearDifference[] = [];
  const playerItems = comparableItemsByGroup(player);

  for (const group of comparableSlotGroups(targetPopulation)) {
    const candidates = new Set<number>();
    for (const member of targetPopulation) {
      for (const itemId of comparableItemsByGroup(member).get(group) ?? []) candidates.add(itemId);
    }

    for (const itemId of [...candidates].sort((a, b) => a - b)) {
      const target = slotItemAdoption(targetPopulation, group, itemId);
      const own = slotItemAdoption(ownPopulation, group, itemId);
      const delta = target.value - own.value;
      if (!isDiscriminative(delta)) continue;

      differences.push({
        slotGroup: group,
        itemId,
        target,
        own,
        delta,
        playerHasIt: playerItems.get(group)?.has(itemId) ?? false,
      });
    }
  }

  // Desempate por slot e item para que el reporte sea reproducible.
  differences.sort(
    (a, b) =>
      Math.abs(b.delta) - Math.abs(a.delta) ||
      a.slotGroup.localeCompare(b.slotGroup) ||
      a.itemId - b.itemId,
  );

  return differences.slice(0, Math.max(top, 0));
}

// --- Talentos ---

export interface TalentCodeAdoption {
  code: string;
  adoption: AdoptionRate;
}

/**
 * Comparación de talentos por coincidencia exacta de `talent_loadout_code`.
 *
 * Deliberadamente NO hay un "% aligned" de talentos como el de gear. Con
 * coincidencia exacta, el parecido de un jugador con el segmento de arriba solo
 * puede ser 0 o 1, y pintar eso como una barra de porcentaje sugeriría un
 * gradiente que el dato no tiene. Lo que sí es honesto: qué códigos lleva el
 * segmento objetivo y en qué proporción, y dónde cae el del jugador.
 *
 * Los nodos ya tienen su propio adoption_rate por segmento desde el ADR 0026,
 * así que el alignment score real es posible; construirlo es #18.
 */
export interface TalentComparison {
  /** Códigos más frecuentes del segmento objetivo, de mayor a menor adopción. */
  topCodes: TalentCodeAdoption[];
  /** El código del jugador, o null si no está disponible. */
  playerCode: string | null;
  /** Adopción del código del jugador en el segmento objetivo. null si no tiene código. */
  playerCodeAdoption: AdoptionRate | null;
  /** Códigos distintos observados en el segmento objetivo: mide lo dividida que está la spec. */
  distinctCodes: number;
  /** Perfiles del segmento objetivo sin código, fuera del denominador (regla 5). */
  unavailable: number;
  /**
   * Si la comparación por código exacto aporta señal utilizable.
   *
   * Cuando casi cada jugador tiene un código distinto, el código "más frecuente"
   * del segmento lo lleva un 3-7% y decir "el X% de 2000-2200 usa esta build" es
   * cierto pero inútil: describe a tres personas, no al segmento. En ese caso el
   * consumidor debe explicar la limitación, no pintar un top-3 que parece un
   * consenso inexistente. El umbral es el mismo que discrimina el gear (§13.3):
   * si ni el código más llevado alcanza esa adopción, no hay build mayoritaria.
   */
  hasUsableSignal: boolean;
}

export function compareTalents(
  player: PlayerBuild,
  targetPopulation: readonly PlayerBuild[],
  top: number = DEFAULT_TOP_TALENT_CODES,
): TalentComparison {
  const counts = new Map<string, number>();
  let unavailable = 0;

  for (const member of targetPopulation) {
    const code = member.talentLoadoutCode;
    if (code === null) {
      unavailable++;
      continue;
    }
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  const denominator = targetPopulation.length - unavailable;
  const toAdoption = (users: number): AdoptionRate => ({
    value: denominator === 0 ? 0 : users / denominator,
    users,
    denominator,
    unavailable,
  });

  const topCodes = [...counts]
    // Empate por código para que el orden no dependa del de inserción.
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(top, 0))
    .map(([code, users]) => ({ code, adoption: toAdoption(users) }));

  const playerCode = player.talentLoadoutCode;

  return {
    topCodes,
    playerCode,
    // Un código que nadie más lleva da adopción 0 sobre el denominador real —
    // que es un dato, distinto de "no se pudo calcular".
    playerCodeAdoption: playerCode === null ? null : toAdoption(counts.get(playerCode) ?? 0),
    distinctCodes: counts.size,
    unavailable,
    hasUsableSignal: (topCodes[0]?.adoption.value ?? 0) >= MIN_DISCRIMINATIVE_DELTA,
  };
}

// --- Item level ---

/**
 * Comparación de item level **equipado** (ver PlayerBuild.equippedItemLevel).
 */
export interface ItemLevelComparison {
  /** null si el perfil del jugador no traía item level. */
  player: number | null;
  ownMedian: number | null;
  targetMedian: number | null;
  /** Perfiles con item level disponible en cada segmento (el denominador real). */
  ownSample: number;
  targetSample: number;
}

export function compareItemLevel(
  player: PlayerBuild,
  ownPopulation: readonly PlayerBuild[],
  targetPopulation: readonly PlayerBuild[],
): ItemLevelComparison {
  const levels = (population: readonly PlayerBuild[]): number[] =>
    population
      .map((member) => member.equippedItemLevel)
      .filter((level): level is number => level !== null);

  const own = levels(ownPopulation);
  const target = levels(targetPopulation);

  return {
    player: player.equippedItemLevel,
    ownMedian: median(own),
    targetMedian: median(target),
    ownSample: own.length,
    targetSample: target.length,
  };
}

// --- Player Gap ---

export interface PlayerGapInput {
  player: PlayerBuild;
  ownSegment: RatingSegment;
  targetSegment: RatingSegment;
  /** Población muestreada del segmento del jugador (él incluido: es uno más del segmento). */
  ownPopulation: readonly PlayerBuild[];
  /** Población muestreada del segmento inmediatamente superior. */
  targetPopulation: readonly PlayerBuild[];
  topDifferences?: number;
  topTalentCodes?: number;
}

/**
 * Player Gap no disponible. Lleva el motivo porque §13.4 exige explicar por qué
 * no hay comparación, no dejar un hueco en blanco.
 */
export interface PlayerGapUnavailable {
  available: false;
  reason: string;
  ownSegment: RatingSegment;
  targetSegment: RatingSegment;
  targetSampleSize: number;
  confidence: ConfidenceLevel;
}

export interface PlayerGapResult {
  available: true;
  ownSegment: RatingSegment;
  targetSegment: RatingSegment;
  ownSampleSize: number;
  targetSampleSize: number;
  confidence: ConfidenceLevel;
  gear: GearAlignment;
  differences: GearDifference[];
  talents: TalentComparison;
  itemLevel: ItemLevelComparison;
}

export type PlayerGap = PlayerGapResult | PlayerGapUnavailable;

/**
 * La comparación completa de un jugador contra el segmento inmediatamente
 * superior (§13.1).
 *
 * La puerta de entrada es canShowComparison() sobre el segmento **objetivo**:
 * es la población de la que salen todos los porcentajes que se enseñan. Que el
 * segmento propio tenga poca muestra empeora el delta, pero el número que el
 * producto afirma ("el X% del siguiente segmento lleva esto") depende del de
 * arriba.
 */
export function computePlayerGap(input: PlayerGapInput): PlayerGap {
  const { player, ownSegment, targetSegment, ownPopulation, targetPopulation } = input;
  const targetSampleSize = targetPopulation.length;
  const confidence = confidenceFor(targetSampleSize);

  if (!canShowComparison(targetSampleSize)) {
    return {
      available: false,
      reason:
        `No hay suficientes jugadores muestreados en ${targetSegment.id} para una ` +
        `comparación fiable (n=${targetSampleSize}).`,
      ownSegment,
      targetSegment,
      targetSampleSize,
      confidence,
    };
  }

  return {
    available: true,
    ownSegment,
    targetSegment,
    ownSampleSize: ownPopulation.length,
    targetSampleSize,
    confidence,
    gear: gearAlignment(player, targetPopulation),
    differences: biggestGearDifferences(
      player,
      ownPopulation,
      targetPopulation,
      input.topDifferences ?? DEFAULT_TOP_DIFFERENCES,
    ),
    talents: compareTalents(
      player,
      targetPopulation,
      input.topTalentCodes ?? DEFAULT_TOP_TALENT_CODES,
    ),
    itemLevel: compareItemLevel(player, ownPopulation, targetPopulation),
  };
}
