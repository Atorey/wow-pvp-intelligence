import {
  MIN_SAMPLE_MEDIUM,
  biggestDifferences,
  canShowComparison,
  confidenceFor,
  gearOverlap,
  nextSegment,
  parseShuffleBracket,
  segmentFor,
  slotGroup,
  specSlug,
  type ConfidenceLevel,
  type GearAlignment,
  type RatingSegment,
  type SegmentDifference,
  type SpecEntry,
} from "@wowpvp/core";
import {
  toAggregatedVariable,
  type AdoptionRead,
  type CharacterGearRead,
  type CharacterSnapshotRead,
  type CharacterTalentsRead,
  type SegmentRead,
  type StandingRead,
} from "@wowpvp/data";

/**
 * Qué enseña la página de perfil, decidido sin tocar la base de datos.
 *
 * Está separado de las lecturas por la misma razón por la que `percentileFor`
 * no vive dentro de su consulta: lo que aquí puede salir mal no es el `order
 * by`, es elegir el bracket equivocado, contar la confianza sobre el
 * denominador equivocado o llamar "no hay gente" a "no tenemos su equipo". Todo
 * eso se prueba con objetos y sin Postgres delante.
 */

/** Una spec observada del personaje, tal como la ofrece el selector. */
export interface ObservedSpec {
  /** El bracket de Blizzard: la clave con la que se leen sus datos. */
  bracket: string;
  /** El slug canónico (`frost-mage`), que es lo que viaja en la URL. */
  slug: string;
  spec: SpecEntry;
  rating: number;
}

/**
 * El estado de la caja Player Gap.
 *
 * Son estados y no niveles porque son layouts distintos (§5.2 del sistema): el
 * tipo obliga a tratarlos como tales en vez de a pintar la misma caja con un
 * borde de otro color.
 */
export type GapView =
  /** §1.6: el tramo abierto no tiene escalón encima, y eso no es falta de muestra. */
  | { state: "top-segment"; ownSegment: RatingSegment }
  | {
      state: "insufficient";
      ownSegment: RatingSegment;
      targetSegment: RatingSegment;
      /**
       * `population` es cuánta gente hay arriba; `gearSample`, de cuántos
       * tenemos el equipo. La causa se decide con las dos: echarle al juego la
       * culpa de nuestro muestreo es la mentira fácil de esta caja (§1.5).
       *
       * `subject` es la tercera causa, que la §1.5 no contempla porque en agosto
       * no se daba: el segmento de arriba está muestreado y de quien mira no
       * tenemos perfil. Pasa con cualquiera que aparezca en el leaderboard y a
       * quien nadie haya consultado — el leaderboard trae rating y nada más—, y
       * decirle "nos falta muestrear ahí arriba" sería señalar el sitio
       * equivocado.
       */
      cause: "population" | "sampling" | "subject";
      population: number;
      gearSample: number;
      needed: number;
    }
  | {
      state: "comparable";
      ownSegment: RatingSegment;
      targetSegment: RatingSegment;
      confidence: Extract<ConfidenceLevel, "high" | "medium">;
      gearSample: number;
      /** null cuando la mediana del objetivo no tiene base suficiente. */
      itemLevel: { player: number; median: number; denominator: number } | null;
      /**
       * El solapamiento de gear: la media de la adopción que tienen los items de
       * quien mira en el escalón de arriba. `null` cuando no hay ni un item
       * comparable, que no es un cero — un cero diría "no llevas nada de lo que
       * llevan ahí" y eso sí lo habríamos medido.
       */
      overlap: GearAlignment | null;
      /** La lista de gear: item, gema y encantamiento en un mismo ranking (ADR 0027). */
      gear: ListView;
      /** La de nodos de talento, aparte porque su denominador es otro (ADR 0026). */
      talents: ListView;
    };

/**
 * Una fila de la lista, con lo que `packages/core` no sabe y la fila necesita.
 *
 * El icono y la marca de "lo llevas" se añaden aquí y no allí a propósito:
 * `biggestDifferences()` compara dos escalones y no mira a nadie en concreto, y
 * de iconos no sabe nada. Lo que se pinta sí necesita las dos cosas.
 */
export interface DifferenceView extends SegmentDifference {
  /**
   * Si quien mira lleva ya esa variable. Es contexto, no un juicio, y solo se
   * afirma cuando tenemos su observación: sin equipo leído no se marca ninguna
   * fila, porque una fila sin marca diría "no lo llevas" (regla 5).
   */
  playerHasIt: boolean;
  iconUrl: string | null;
}

/**
 * Una de las dos listas de la caja.
 *
 * Cada una lleva su propia `n` y su propia confianza, y no la de la caja: el
 * gear se compara sobre `gear_sample` y los nodos sobre `talent_node_sample`,
 * que hoy difieren en órdenes de magnitud porque los nodos empiezan a contarse
 * en la migración 0012 (ADR 0026). Una sola confianza para las dos presentaría
 * la más floja con el aval de la más sólida.
 *
 * **Y hacen falta los dos lados.** La caja entera se decide con el denominador
 * del escalón de arriba (decisión 3 del ADR 0010), pero una fila dice dos
 * porcentajes, y el de abajo necesita su propia base: sin ella, "21% en tu
 * tramo" sería un 0/0 pintado como un dato.
 */
export type ListView =
  | {
      state: "listed";
      confidence: Extract<ConfidenceLevel, "high" | "medium">;
      /** El denominador del escalón de arriba: la base de los porcentajes de esta lista. */
      sample: number;
      /** Cuántos quedaron fuera del denominador por no tener el dato (regla 5). */
      unavailable: number;
      differences: DifferenceView[];
    }
  | {
      state: "insufficient";
      /** Cuál de los dos lados no tiene base: el de arriba o el propio. */
      missing: "own" | "target";
      /** Lo que hay en ese lado, que es lo que hay que decir en pantalla. */
      sample: number;
      needed: number;
    };

export interface StandingView {
  /** El recuento crudo: cuántos observados hay y cuántos están por debajo. */
  counts: StandingRead;
  ownSegment: RatingSegment;
  targetSegment: RatingSegment | undefined;
  /** Población del segmento propio y del objetivo, con la ventana con la que se contó. */
  ownPopulation: number | null;
  targetPopulation: number | null;
  activityWindowDays: number | null;
}

/**
 * Las specs que el personaje juega, ordenadas por rating.
 *
 * Se filtra a lo que `parseShuffleBracket` reconoce y no se enseña lo demás: un
 * bracket que el catálogo no sabe nombrar no tiene ni spec ni clase que pintar,
 * y adivinarlas partiendo el string por guiones es justo lo que prohíbe el ADR
 * 0016. Hoy no hay ninguno, porque solo se ingiere Solo Shuffle.
 */
export function observedSpecs(snapshots: readonly CharacterSnapshotRead[]): ObservedSpec[] {
  return snapshots
    .flatMap((snapshot) => {
      const spec = parseShuffleBracket(snapshot.bracket);
      if (!spec) return [];
      return [{ bracket: snapshot.bracket, slug: specSlug(spec), spec, rating: snapshot.rating }];
    })
    .sort((a, b) => b.rating - a.rating || a.slug.localeCompare(b.slug));
}

/**
 * Qué spec abre la página.
 *
 * Por defecto la de mayor rating, que es la que el jugador considera suya, y no
 * la observada más recientemente: esa cambiaría sola entre visitas y con ella
 * cambiaría el sujeto de la comparación. Lo pedido en la URL manda sobre el
 * defecto, y un slug que este personaje no juega **no es un 404**: la ruta
 * identifica al personaje, no a la spec.
 */
export function pickSpec(specs: readonly ObservedSpec[], requested?: string): ObservedSpec | null {
  const asked = requested ? specs.find((entry) => entry.slug === requested) : undefined;
  return asked ?? specs[0] ?? null;
}

/**
 * El estado de la caja para un rating y su segmento objetivo.
 *
 * El `n` que decide es el `gear_sample` del objetivo, nunca su población
 * (decisión 3 del ADR 0010): hay segmentos con miles de personas y cero
 * perfiles con equipo, y presentarlos como comparables es exactamente lo que
 * `canShowComparison()` existe para impedir.
 */
export function gapFor(input: {
  rating: number;
  /** Lo observado de quien mira: su item level, su equipo y sus nodos. */
  player: PlayerSide;
  /** La fila del segmento objetivo, o null si esa corrida no lo calculó. */
  target: SegmentRead | null;
  /** Las adopciones de los dos escalones, ya leídas. */
  adoptions: { gear: AdoptionSides; talentNodes: AdoptionSides };
}): GapView {
  const ownSegment = segmentFor(input.rating);
  const targetSegment = nextSegment(ownSegment);
  if (!targetSegment) return { state: "top-segment", ownSegment };

  const population = input.target?.population.sampleSize ?? 0;
  const gearSample = input.target?.gear.denominator ?? 0;
  // Sin nada observado de quien mira no hay comparación posible por muy
  // muestreado que esté el segmento de arriba, así que esta causa se mira antes
  // que las otras dos: es la única que señala a un lado de la comparación que
  // sí se puede arreglar consultando el perfil.
  const hasSubjectData = input.player.itemLevel !== null;

  if (!hasSubjectData || !canShowComparison(gearSample)) {
    return {
      state: "insufficient",
      ownSegment,
      targetSegment,
      // Hay gente arriba y lo que falta es su equipo: eso es muestreo nuestro.
      // Sin gente arriba, no hay nada que muestrear todavía.
      cause: !hasSubjectData
        ? "subject"
        : canShowComparison(population)
          ? "sampling"
          : "population",
      population,
      gearSample,
      needed: MIN_SAMPLE_MEDIUM,
    };
  }

  const confidence = confidenceFor(gearSample);
  const items = input.player.gear?.items ?? [];
  return {
    state: "comparable",
    ownSegment,
    targetSegment,
    // El `insufficient` ya salió arriba; el tipo lo estrecha aquí para que la
    // caja no tenga que volver a preguntarse por un estado imposible.
    confidence: confidence === "high" ? "high" : "medium",
    gearSample,
    itemLevel: itemLevelComparison(input.player.itemLevel, input.target),
    overlap:
      input.player.gear === null
        ? null
        : gearOverlap(items, input.adoptions.gear.target.map(toAggregatedVariable)),
    gear: listFor({ ...input.adoptions.gear, playerKeys: gearKeys(input.player.gear) }),
    talents: listFor({
      ...input.adoptions.talentNodes,
      playerKeys: talentKeys(input.player.talents),
    }),
  };
}

/** Lo observado de quien mira, que es un lado de las dos comparaciones. */
export interface PlayerSide {
  itemLevel: number | null;
  gear: CharacterGearRead | null;
  talents: CharacterTalentsRead | null;
}

/** Las adopciones de una misma familia de variable en los dos escalones. */
export interface AdoptionSides {
  own: readonly AdoptionRead[];
  target: readonly AdoptionRead[];
}

/**
 * Las claves de variable del equipo de quien mira, para marcar la lista.
 *
 * `null` es "no lo hemos leído", y no se marca nada: una fila sin marca en una
 * lista donde otras la tienen se lee como "esto no lo llevas", que sería
 * afirmar algo no observado (regla 5).
 *
 * Las claves las construye este módulo con `slotGroup()` y no a mano, porque
 * tienen que salir idénticas a las que escribió `refresh-aggregates`: si un
 * anillo se buscara como `FINGER_1:x` y estuviera guardado como `FINGER:x`, la
 * marca no aparecería nunca y nadie vería un error.
 */
export function gearKeys(gear: CharacterGearRead | null): ReadonlySet<string> | null {
  if (gear === null) return null;

  const keys = new Set<string>();
  for (const item of gear.items) {
    keys.add(`${slotGroup(item.slot)}:${item.itemId}`);
    for (const gem of item.gemItemIds) keys.add(`gem:${gem}`);
    for (const enchant of item.enchantmentIds) keys.add(`enchant:${enchant}`);
  }
  return keys;
}

/** Lo mismo para los nodos, con la clave `${árbol}:${id}` de `aggregateTalentNodes()`. */
export function talentKeys(talents: CharacterTalentsRead | null): ReadonlySet<string> | null {
  if (talents === null) return null;
  return new Set(talents.nodes.map((node) => `${node.tree}:${node.talentId}`));
}

/**
 * Una lista de diferencias, con su estado.
 *
 * **La `n` sale de las filas y no del escalón.** Casi siempre coinciden, pero
 * cuando difieren la buena es la de la fila, que es sobre quien de verdad se
 * calculó ese porcentaje (ADR 0007, decisión 3). Y un escalón sin ninguna fila
 * calculada da denominador 0 por este mismo camino, que es la respuesta
 * correcta: sin filas no hay lista que enseñar, aunque el `gear_sample` de la
 * cabecera diga otra cosa.
 *
 * Una lista **vacía no es un fallo**: significa que ninguna variable supera el
 * umbral discriminante, y §13.5 dice que las diferencias pequeñas se ocultan en
 * vez de rellenar el hueco. Quien la pinta lo dice con esas palabras.
 */
export function listFor(input: {
  own: readonly AdoptionRead[];
  target: readonly AdoptionRead[];
  playerKeys: ReadonlySet<string> | null;
}): ListView {
  const targetSample = input.target[0]?.provenance.denominator ?? 0;
  const ownSample = input.own[0]?.provenance.denominator ?? 0;

  // El de arriba se mira primero porque es el que describe la lista entera: si
  // ahí no hay base, no hay nada que contar del escalón objetivo.
  if (!canShowComparison(targetSample)) {
    return {
      state: "insufficient",
      missing: "target",
      sample: targetSample,
      needed: MIN_SAMPLE_MEDIUM,
    };
  }
  if (!canShowComparison(ownSample)) {
    return { state: "insufficient", missing: "own", sample: ownSample, needed: MIN_SAMPLE_MEDIUM };
  }

  const iconsByKey = new Map(input.target.map((row) => [row.variableKey, row.iconUrl]));
  const differences = biggestDifferences(
    input.own.map(toAggregatedVariable),
    input.target.map(toAggregatedVariable),
  ).map((difference) => ({
    ...difference,
    playerHasIt: input.playerKeys?.has(difference.variable.key) ?? false,
    iconUrl: iconsByKey.get(difference.variable.key) ?? null,
  }));

  const confidence = confidenceFor(targetSample);
  return {
    state: "listed",
    confidence: confidence === "high" ? "high" : "medium",
    sample: targetSample,
    // De la fila de arriba, que es la que sostiene los porcentajes que se leen
    // como "lo que lleva el escalón objetivo".
    unavailable: input.target[0]?.unavailable ?? 0,
    differences,
  };
}

/**
 * La cifra de item level con su propio denominador.
 *
 * No cuelga de la confianza de la caja porque no se calcula sobre la misma
 * gente: el `gear_sample` cuenta perfiles con equipo legible y la mediana sale
 * de `item_level_sample`. Casi siempre coinciden; el día que no, la que manda
 * es la de esta cifra (ADR 0007, decisión 3).
 */
function itemLevelComparison(
  player: number | null,
  target: SegmentRead | null,
): { player: number; median: number; denominator: number } | null {
  const median = target?.equippedItemLevelMedian ?? null;
  if (player === null || median === null || !target) return null;
  if (!canShowComparison(target.itemLevel.denominator)) return null;

  return { player, median, denominator: target.itemLevel.denominator };
}

/**
 * El bloque descriptivo: dónde cae el jugador en la población observada.
 *
 * No pasa por `canShowComparison()` —contar no estima nada (punto 3 del ADR
 * 0011)—, pero sí hereda que toda cifra viaje con su denominador. Las dos
 * poblaciones que junta no son la misma: la del percentil es la temporada
 * entera y la de los segmentos está recortada por ventana de actividad, así que
 * la ventana viaja con ellas para que la página pueda decirlo.
 */
export function standingFor(input: {
  rating: number;
  standing: StandingRead;
  segments: readonly SegmentRead[];
}): StandingView {
  const ownSegment = segmentFor(input.rating);
  const targetSegment = nextSegment(ownSegment);
  const find = (segment: RatingSegment | undefined): SegmentRead | undefined =>
    segment ? input.segments.find((row) => row.segment.id === segment.id) : undefined;

  const own = find(ownSegment);
  const target = find(targetSegment);

  return {
    counts: input.standing,
    ownSegment,
    targetSegment,
    ownPopulation: own?.population.sampleSize ?? null,
    targetPopulation: target?.population.sampleSize ?? null,
    // La ventana sale de la fila que se está enseñando y no de una constante:
    // `refresh-aggregates` puede haber caído a 14 días en ese segmento.
    activityWindowDays: own?.activityWindowDays ?? target?.activityWindowDays ?? null,
  };
}
