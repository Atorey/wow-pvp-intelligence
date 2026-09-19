/**
 * Agregados por segmento de población (docs/product-plan.md §27 y §28, #15).
 *
 * §27 define dos entidades derivadas de los snapshots: `PopulationSegment` —el
 * escalón (temporada, bracket, spec, rango de rating) con su tamaño y su forma—
 * y `AggregateSnapshot` —el adoption_rate de cada variable dentro de ese
 * escalón—. Aquí viven las dos como funciones puras; el job de pipeline solo
 * carga población, llama a esto y escribe filas.
 *
 * Puro y en core, no en el pipeline, por la misma razón que Player Gap: la web
 * de Phase 2 lee estos agregados y tiene que poder recalcularlos igual. Un
 * adoption_rate que se calculara distinto al publicarlo y al compararlo daría
 * dos números para la misma población.
 *
 * Lo que este módulo NO decide:
 *
 * - **Quién está activo.** Recibe la población ya filtrada por ventana de
 *   actividad; la ventana es un parámetro del llamante, que además la guarda
 *   junto al resultado (§27, "Active Players").
 * - **Qué se enseña.** Aquí se agrega todo lo observado, incluidos los
 *   segmentos con muestra insuficiente: guardar no es mostrar. La puerta sigue
 *   siendo `canShowComparison()` en el consumidor — necesitamos la fila con
 *   n=12 precisamente para saber cuánto le falta a esa spec para llegar a 30.
 */
import {
  comparableItemsByGroup,
  hasComparableGear,
  hasComparablePvpTalents,
  hasComparableTalents,
  type AdoptionRate,
  type PlayerBuild,
  type TalentSelection,
} from "./player-gap";
import { median, percentile } from "./stats";

/**
 * Tipos de variable agregada.
 *
 * Es un conjunto cerrado a propósito: son las que el schema de hoy puede
 * observar. Stats secundarias y embellishments (§13.1) no están porque
 * `character_snapshot_gear` no las guarda. Añadir una variable es añadir aquí un
 * valor y en la migración un check — no hay un cajón genérico donde meter
 * cualquier cosa sin decidirlo.
 *
 * Las tres de gear comparten denominador (`gear_sample`) porque salen de la
 * misma fila observada, al revés que las de talentos (ADR 0027).
 *
 * `talent-code` sigue estando aunque no agrupe casi nada: el reparto de códigos
 * es en sí el dato que mide esa división, y su histórico arranca antes que el de
 * los nodos (ADR 0026).
 */
export type AggregateVariableKind =
  | "gear-item"
  | "gear-gem"
  | "gear-enchant"
  | "talent-code"
  | "talent-node"
  | "pvp-talent"
  | "hero-tree";

/** El adoption_rate de una variable dentro de un segmento (§13.2). */
export interface AggregatedVariable {
  kind: AggregateVariableKind;
  /** Clave estable dentro del segmento: "TRINKET:207581" o el código de talentos. */
  key: string;
  /** Grupo de slots normalizado ('TRINKET', no 'TRINKET_1'). null en talentos. */
  slotGroup: string | null;
  /** item_id, para que el llamante pueda resolver el nombre. null en talentos. */
  itemId: number | null;
  /**
   * Nombre del item, cuando la observación lo traía consigo. Lo traen las gemas,
   * que llegan con nombre en la misma respuesta; el item equipado no, porque
   * `PlayerBuild` lo reduce a su id y el nombre lo resuelve quien escribe.
   */
  itemName: string | null;
  /** Árbol del nodo. null salvo en 'talent-node' y 'pvp-talent'. */
  talentTree: string | null;
  /** Id del nodo o del talento PvP; en 'hero-tree', el id del árbol. */
  talentId: number | null;
  /** Nombre legible al calcular. null es "no disponible" (regla 5), no "sin nombre". */
  talentName: string | null;
  /**
   * Id del encantamiento. Aparte de `itemId` y no por purismo: la lectura junta
   * el catálogo de iconos por `item_id`, así que un encantamiento guardado ahí
   * cruzaría con el item que compartiera ese número (ADR 0027).
   */
  enchantmentId: number | null;
  /** Nombre del encantamiento, tal como lo daba su `display_string`. */
  enchantmentName: string | null;
  adoption: AdoptionRate;
}

/** La forma de un segmento: cuánta gente hay y cómo se reparte (§27). */
export interface SegmentSummary {
  /**
   * Personajes activos del segmento: población, no base de comparación.
   *
   * El resumen no trae el nivel de confianza aunque sepa calcularlo. Devolverlo
   * ponía en un mismo objeto un `sampleSize` y un `confidence` sin decir cuál de
   * los cinco denominadores de aquí abajo lo sostenía, y así acabó guardado en
   * la base una confianza `high` sobre segmentos con `gearSample` a cero
   * (ADR 0033). Se deriva donde se usa, con `confidenceFor()` sobre el
   * denominador de esa cifra.
   */
  sampleSize: number;
  ratingMedian: number | null;
  ratingP25: number | null;
  ratingP75: number | null;
  ratingMin: number | null;
  ratingMax: number | null;
  /** Mediana del item level **equipado** (ver PlayerBuild.equippedItemLevel). */
  equippedItemLevelMedian: number | null;
  /**
   * Denominadores reales de cada bloque de variables, que casi nunca coinciden
   * con `sampleSize`: el rating llega del leaderboard para todo el mundo, pero
   * gear, talentos e item level solo existen donde hemos bajado el perfil
   * completo. Se guardan para que un adoption_rate del 60% no pueda leerse como
   * "60% del segmento" cuando en realidad es "60% de los 40 perfiles que
   * tenemos de un segmento de 3.000".
   */
  itemLevelSample: number;
  gearSample: number;
  /** Miembros con `talent_loadout_code`. No es la base de los nodos. */
  talentSample: number;
  /**
   * Códigos de loadout **distintos** observados en el segmento.
   *
   * Es la medida de la división que el ADR 0026 describe: sobre `talentSample`
   * da directamente "cuántas builds distintas por cada cien perfiles". Vive aquí
   * y no en una fila por código porque el 92,8% de esas filas tenía un único
   * usuario, y una fila que describe a una persona no puede enseñarse nunca
   * —`canShowComparison()` pide n≥30— pero sí se contaba en el tamaño.
   */
  talentCodeDistinct: number;
  /**
   * Miembros con nodos, y con talentos PvP. Tres cifras y no una porque
   * divergen: el código lleva guardado desde agosto de 2026 y los nodos empiezan
   * con el ADR 0026, así que durante días habrá segmentos con `talentSample` a
   * 100 y `talentNodeSample` a 0. Fundirlos daría un número que no describe a
   * ninguna de las tres.
   */
  talentNodeSample: number;
  pvpTalentSample: number;
}

export function summarizeSegment(population: readonly PlayerBuild[]): SegmentSummary {
  const ratings = population.map((member) => member.rating);
  const itemLevels = population
    .map((member) => member.equippedItemLevel)
    .filter((level): level is number => level !== null);

  return {
    sampleSize: population.length,
    ratingMedian: median(ratings),
    ratingP25: percentile(ratings, 0.25),
    ratingP75: percentile(ratings, 0.75),
    ratingMin: percentile(ratings, 0),
    ratingMax: percentile(ratings, 1),
    equippedItemLevelMedian: median(itemLevels),
    itemLevelSample: itemLevels.length,
    gearSample: population.filter(hasComparableGear).length,
    talentSample: population.filter((member) => member.talentLoadoutCode !== null).length,
    talentCodeDistinct: new Set(
      population
        .map((member) => member.talentLoadoutCode)
        .filter((code): code is string => code !== null),
    ).size,
    talentNodeSample: population.filter(hasComparableTalents).length,
    pvpTalentSample: population.filter(hasComparablePvpTalents).length,
  };
}

/**
 * adoption_rate de cada item observado, por grupo de slots.
 *
 * Una sola pasada contando, en vez de llamar a `slotItemAdoption` por item: con
 * 40 brackets × segmentos × cientos de items, recorrer la población entera una
 * vez por item convierte el recálculo diario en minutos de CPU para dar
 * exactamente el mismo número (hay un test que lo comprueba contra la función
 * de Player Gap, para que las dos no puedan divergir en silencio).
 *
 * Los perfiles sin equipo legible salen del denominador y se cuentan como
 * `unavailable` (regla 5 del proyecto): un personaje del que solo tenemos la
 * fila de leaderboard no es alguien que "no lleva ese item".
 */
export function aggregateGearItems(population: readonly PlayerBuild[]): AggregatedVariable[] {
  const usersByGroup = new Map<string, Map<number, number>>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    if (!hasComparableGear(member)) {
      unavailable++;
      continue;
    }
    denominator++;

    for (const [group, items] of comparableItemsByGroup(member)) {
      let counts = usersByGroup.get(group);
      if (!counts) {
        counts = new Map<number, number>();
        usersByGroup.set(group, counts);
      }
      for (const itemId of items) counts.set(itemId, (counts.get(itemId) ?? 0) + 1);
    }
  }

  const variables: AggregatedVariable[] = [];
  for (const [group, counts] of [...usersByGroup].sort(([a], [b]) => a.localeCompare(b))) {
    for (const [itemId, users] of [...counts].sort((a, b) => a[0] - b[0])) {
      variables.push({
        kind: "gear-item",
        key: `${group}:${itemId}`,
        slotGroup: group,
        itemId,
        itemName: null,
        talentTree: null,
        talentId: null,
        talentName: null,
        enchantmentId: null,
        enchantmentName: null,
        adoption: { value: users / denominator, users, denominator, unavailable },
      });
    }
  }
  return variables;
}

/**
 * adoption_rate de cada `talent_loadout_code` observado.
 *
 * Coincidencia exacta del código completo, con la limitación de siempre: dos
 * builds que difieran en un solo nodo cuentan como distintas, así que esto
 * describe una población muy dividida y no una "build del segmento". Lo que se
 * compara de verdad son los nodos (`aggregateTalentNodes`, ADR 0026).
 *
 * Solo salen los códigos que lleva **más de una persona**. El reparto en sí no
 * se pierde: lo mide `SegmentSummary.talentCodeDistinct`, que es la cifra que
 * de verdad describe la división, y para eso basta un entero por segmento en vez
 * de una fila por código. Lo que se deja de guardar son las filas de un solo
 * usuario, que eran el 92,8% del total y que ninguna pantalla puede enseñar:
 * `canShowComparison()` no deja publicar una comparación por debajo de n=30, así
 * que una adopción de una persona es tamaño sin lectura posible.
 */
/**
 * Usuarios mínimos para que un código de loadout llegue a guardarse.
 *
 * Dos y no uno porque uno es, literalmente, "esta build la lleva esta persona":
 * no agrupa, no se puede enseñar y se multiplicaba por cada segmento y corrida.
 */
const TALENT_CODE_MIN_USERS = 2;

export function aggregateTalentCodes(population: readonly PlayerBuild[]): AggregatedVariable[] {
  const counts = new Map<string, number>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    const code = member.talentLoadoutCode;
    if (code === null) {
      unavailable++;
      continue;
    }
    denominator++;
    counts.set(code, (counts.get(code) ?? 0) + 1);
  }

  return [...counts]
    .filter(([, users]) => users >= TALENT_CODE_MIN_USERS)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([code, users]) => ({
      kind: "talent-code" as const,
      key: code,
      slotGroup: null,
      itemId: null,
      itemName: null,
      talentTree: null,
      talentId: null,
      talentName: null,
      enchantmentId: null,
      enchantmentName: null,
      adoption: { value: users / denominator, users, denominator, unavailable },
    }));
}

/** Cómo se identifica un nodo o un talento PvP dentro de su segmento. */
function talentIdentity(selection: TalentSelection): VariableIdentity {
  return {
    ...NO_IDENTITY,
    key: `${selection.tree}:${selection.talentId}`,
    talentTree: selection.tree,
    talentId: selection.talentId,
    talentName: selection.talentName,
  };
}

/**
 * adoption_rate de cada gema engarzada.
 *
 * Su denominador es el del gear y no uno propio: las gemas vienen en la misma
 * fila observada que el item, así que quien tiene equipo legible tiene gemas
 * legibles. Un equipo sin ninguna gema cuenta dentro con adopción 0 — eso es
 * "no engemó", que es un hecho, y no "no lo sabemos" (ADR 0027).
 *
 * Sin `slotGroup`: la misma gema se engarza en piezas distintas y agruparla por
 * hueco partiría su adopción en varias, que es el artefacto que §6.3 de findings
 * ya corrigió con los abalorios.
 */
export function aggregateGearGems(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return countSelections(
    population,
    hasComparableGear,
    (member) => member.gems,
    "gear-gem",
    (gem) => ({ ...NO_IDENTITY, key: `gem:${gem.id}`, itemId: gem.id, itemName: gem.name }),
  );
}

/**
 * adoption_rate de cada encantamiento.
 *
 * Mismo denominador y misma regla de agrupación que las gemas. Lo que cambia es
 * que **no rellena `itemId`**: un encantamiento no es un item, y meter su id ahí
 * lo cruzaría con el catálogo de iconos por un número que coincide sin querer.
 * Se queda sin icono, que es el estado normal de §4.5 del brief — lo que falta
 * ahí es la ilustración, no la cifra (#92).
 */
export function aggregateGearEnchants(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return countSelections(
    population,
    hasComparableGear,
    (member) => member.enchantments,
    "gear-enchant",
    (enchant) => ({
      ...NO_IDENTITY,
      key: `enchant:${enchant.id}`,
      enchantmentId: enchant.id,
      enchantmentName: enchant.name,
    }),
  );
}

/**
 * adoption_rate de cada nodo de talento observado.
 *
 * Esta es la variable que sí agrupa, y la razón de ser del ADR 0026: dos
 * jugadores comparten nodos aunque no compartan build. Con el código completo no
 * la comparten casi nunca —entre 75 y 97 códigos distintos por cada 100 perfiles
 * de un segmento— así que aquel porcentaje describía personas y este describe el
 * escalón.
 *
 * Misma forma que `aggregateGearItems`: una sola pasada contando, y los perfiles
 * sin nodos legibles fuera del denominador y contados en `unavailable` (regla 5).
 * Un personaje del que solo tenemos la fila de leaderboard no es alguien que "no
 * lleva ese talento".
 */
export function aggregateTalentNodes(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return countSelections(
    population,
    hasComparableTalents,
    (member) => member.talents ?? [],
    "talent-node",
    talentIdentity,
  );
}

/**
 * adoption_rate de cada talento PvP.
 *
 * Separado de los nodos y con su propio denominador porque cuelgan de la spec y
 * no del loadout: faltan por razones distintas, y meterlos en la misma base
 * contaría como "no disponible de talentos" a quien tiene el loadout entero.
 */
export function aggregatePvpTalents(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return countSelections(
    population,
    hasComparablePvpTalents,
    (member) => member.pvpTalents ?? [],
    "pvp-talent",
    talentIdentity,
  );
}

/**
 * Reparto de árboles de héroe: una elección entre dos por spec.
 *
 * Es la variable de talentos con menos cardinalidad que existe, y por eso la
 * única que se lee de un vistazo ("71% Mountain Thane, 29% Slayer"). Comparte
 * denominador con los nodos porque sale del mismo loadout, pero su `unavailable`
 * es mayor: la API no trae el árbol en ~8% de los loadouts que sí traen nodos.
 */
export function aggregateHeroTrees(population: readonly PlayerBuild[]): AggregatedVariable[] {
  const counts = new Map<number, { name: string; users: number }>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    const tree = member.heroTalentTree;
    if (tree === null) {
      unavailable++;
      continue;
    }
    denominator++;
    const seen = counts.get(tree.id);
    if (seen) seen.users++;
    else counts.set(tree.id, { name: tree.name, users: 1 });
  }

  return [...counts]
    .sort(([a], [b]) => a - b)
    .map(([id, { name, users }]) => ({
      kind: "hero-tree" as const,
      key: String(id),
      slotGroup: null,
      itemId: null,
      itemName: null,
      talentTree: null,
      talentId: id,
      talentName: name,
      enchantmentId: null,
      enchantmentName: null,
      adoption: { value: users / denominator, users, denominator, unavailable },
    }));
}

/** Una variable identificada, antes de saber a cuánta gente describe. */
type VariableIdentity = Omit<AggregatedVariable, "kind" | "adoption">;

/** La etiqueta de una variable, viva en la columna que le toque por familia. */
function labelOf(identity: VariableIdentity): string | null {
  return identity.itemName ?? identity.talentName ?? identity.enchantmentName;
}

/**
 * El contador que comparten nodos, talentos PvP, gemas y encantamientos:
 * idénticos salvo en de dónde sale la lista, en qué denominador les toca y en
 * cómo se identifica cada selección.
 *
 * El nombre se queda con la primera aparición que lo traiga: la API deja algún
 * nodo sin tooltip y las gemas de los snapshots anteriores a la migración 0013
 * llegan sin nombre. Descartar la selección por eso perdería algo observado por
 * no saber cómo se llama.
 */
function countSelections<T>(
  population: readonly PlayerBuild[],
  isComparable: (member: PlayerBuild) => boolean,
  selectionsOf: (member: PlayerBuild) => readonly T[],
  kind: AggregateVariableKind,
  identify: (selection: T) => VariableIdentity,
): AggregatedVariable[] {
  const counts = new Map<string, { identity: VariableIdentity; users: number }>();
  let denominator = 0;
  let unavailable = 0;

  for (const member of population) {
    if (!isComparable(member)) {
      unavailable++;
      continue;
    }
    denominator++;

    // Un Set porque la misma selección repetida dentro de un mismo personaje
    // sigue siendo un usuario, no dos: quien lleva la misma gema en tres huecos
    // es una persona que la lleva.
    const seen = new Set<string>();
    for (const selection of selectionsOf(member)) {
      const identity = identify(selection);
      if (seen.has(identity.key)) continue;
      seen.add(identity.key);

      const entry = counts.get(identity.key);
      if (entry) {
        entry.users++;
        if (labelOf(entry.identity) === null && labelOf(identity) !== null) {
          entry.identity = identity;
        }
      } else {
        counts.set(identity.key, { identity, users: 1 });
      }
    }
  }

  return [...counts]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, { identity, users }]) => ({
      kind,
      ...identity,
      adoption: { value: users / denominator, users, denominator, unavailable },
    }));
}

/** La identidad vacía, para no repetir siete nulls en cada familia. */
const NO_IDENTITY: Omit<VariableIdentity, "key"> = {
  slotGroup: null,
  itemId: null,
  itemName: null,
  talentTree: null,
  talentId: null,
  talentName: null,
  enchantmentId: null,
  enchantmentName: null,
};

/**
 * Todas las variables agregables de un segmento.
 *
 * Sin filtro por adopción mínima: se guarda hasta el item que lleva una sola
 * persona. El filtro de §13.5 ("las diferencias pequeñas se ocultan") es una
 * regla de presentación, y aplicarla al guardar impediría calcular después el
 * poder discriminante de §13.3 — que necesita justamente las adopciones bajas
 * para saber qué variable no discrimina. El coste es volumen de filas, y esa es
 * una decisión de retención (#48), no de agregación.
 */
export function aggregateSegment(population: readonly PlayerBuild[]): AggregatedVariable[] {
  return [
    ...aggregateGearItems(population),
    ...aggregateGearGems(population),
    ...aggregateGearEnchants(population),
    ...aggregateTalentCodes(population),
    ...aggregateTalentNodes(population),
    ...aggregatePvpTalents(population),
    ...aggregateHeroTrees(population),
  ];
}

/**
 * Reparte una población en segmentos de rating.
 *
 * Recibe la función de segmentación en vez de importarla para que el llamante
 * pueda pasar la escala de la temporada vigente (§27: los límites se revisan
 * por temporada, no se hardcodean permanentemente).
 */
export function groupBySegment<T extends { rating: number }>(
  population: readonly T[],
  segmentOf: (rating: number) => { id: string },
): Map<string, T[]> {
  const bySegment = new Map<string, T[]>();
  for (const member of population) {
    const id = segmentOf(member.rating).id;
    const bucket = bySegment.get(id);
    if (bucket) bucket.push(member);
    else bySegment.set(id, [member]);
  }
  return bySegment;
}
