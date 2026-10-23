import {
  BRACKET_SLUGS,
  MIN_SAMPLE_MEDIUM,
  biggestDifferences,
  bracketSlugFor,
  canShowComparison,
  comparisonTargetFor,
  confidenceFor,
  findSpec,
  gearOverlap,
  isArenaSlug,
  nextSegment,
  parseShuffleBracket,
  playerDifferences,
  segmentFor,
  slotGroup,
  specSlug,
  talentSelectionKey,
  type BracketSlug,
  type ComparisonMode,
  type ComparisonTarget,
  type ConfidenceLevel,
  type GearAlignment,
  type PlayerDifference,
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
  type ObservedSpecRead,
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

/** Una spec observada del personaje en una modalidad, tal como la ofrece el selector. */
export interface ObservedSpec {
  /** El bracket de Blizzard: la clave con la que se leen sus datos. */
  bracket: string;
  /** La modalidad (`solo-shuffle`, `3v3`), que viaja en la URL junto a la spec. */
  bracketSlug: BracketSlug;
  /** El slug canónico (`frost-mage`), que es lo que viaja en la URL. */
  slug: string;
  spec: SpecEntry;
  rating: number;
  /**
   * En arena, cuándo se le vio esa spec: es la que llevaba puesta al bajarle el
   * perfil, no necesariamente con la que juega (ADR 0048), y por eso viaja con
   * su fecha. `null` en Solo Shuffle, donde la nombra el bracket.
   */
  specObservedAt: Date | null;
}

/**
 * Una modalidad de arena con rating y sin spec observada: solo la ha visto el
 * leaderboard, que no la trae (ADR 0048). Se enseña su rating y nada que
 * dependa de la spec.
 */
export interface UnattributedBracket {
  bracket: string;
  bracketSlug: BracketSlug;
  rating: number;
}

/** Lo que hace falta para nombrar las modalidades de un personaje. */
export interface ObservedSpecsOptions {
  /** La última spec observada en cada bracket (`readObservedSpecs`). */
  specs?: readonly ObservedSpecRead[];
  /** Las modalidades que la web publica. Sin decirlo, solo Solo Shuffle. */
  published?: readonly BracketSlug[];
}

/**
 * El estado de la caja Player Gap.
 *
 * Son estados y no niveles porque son layouts distintos (§5.2 del sistema): el
 * tipo obliga a tratarlos como tales en vez de a pintar la misma caja con un
 * borde de otro color.
 */
export type GapView =
  /**
   * §1.6: el tramo abierto no tiene escalón encima, y eso no es falta de muestra.
   * Solo se llega aquí cuando tampoco el propio tiene base: si la tiene, se
   * compara con él (ADR 0051).
   */
  | { state: "top-segment"; ownSegment: RatingSegment }
  | {
      state: "insufficient";
      /**
       * El objetivo que tendría la caja, que es el que nombra su titular. Es
       * `next` cuando no hay ninguno: la ausencia la explica el inmediato.
       */
      mode: ComparisonMode;
      ownSegment: RatingSegment;
      targetSegment: RatingSegment;
      /**
       * De qué corrida salen las cifras de abajo, o `null` si ese escalón no se
       * ha calculado nunca. El §28 del plan lo exige de toda cifra agregada —"de
       * dónde sale y cuándo se calculó"—, y aquí también hay dos: la población y
       * la muestra con las que se explica por qué no hay comparación.
       */
      computedAt: Date | null;
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
      /**
       * Contra qué escalón se compara, que la caja declara porque cambia lo que
       * significan las cifras (ADR 0051): el inmediato, el de encima porque el
       * inmediato no tiene base, o el propio porque no la tiene ninguno de
       * arriba. En `peers`, `targetSegment` es el mismo `ownSegment`.
       */
      mode: ComparisonMode;
      ownSegment: RatingSegment;
      targetSegment: RatingSegment;
      /**
       * Los tramos saltados, con las cifras que explican por qué: lo que se le
       * dice a quien mira es que esos escalones existen y no tienen base, no
       * que no existen. `null` fuera de `skipped`.
       */
      skipped: SkippedSegments | null;
      /** La corrida que produjo estos porcentajes (ADR 0007, decisión 3). */
      computedAt: Date;
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
 * Los tramos saltados hasta el objetivo, de abajo arriba, con su población y
 * su base sumadas.
 *
 * Se suman y no se listan uno a uno porque lo que la caja tiene que decir es
 * una cosa: entre tu tramo y el objetivo hay tantos tramos y en ellos no hay
 * base. Y `count` va aparte porque la distancia es parte del dato: no se lee
 * igual una comparación que salta un tramo que una que salta seis (ADR 0051).
 */
export interface SkippedSegments {
  first: RatingSegment;
  last: RatingSegment;
  count: number;
  population: number;
  gearSample: number;
}

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
 * Una fila de la lista contra quien mira (ADR 0051): lo que lleva el escalón y
 * él no. No lleva marca de "lo llevas" porque, por construcción, no lo lleva.
 */
export interface PlayerDifferenceView extends PlayerDifference {
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
  | (ListedBase & { basis: "segments"; differences: DifferenceView[] })
  | (ListedBase & { basis: "player"; differences: PlayerDifferenceView[] })
  | {
      state: "insufficient";
      /**
       * Qué lado no tiene base: el escalón, el propio tramo o, en la lista
       * contra quien mira, su propia observación de esta familia.
       */
      missing: "own" | "target" | "player";
      /** Lo que hay en ese lado, que es lo que hay que decir en pantalla. */
      sample: number;
      needed: number;
    };

/**
 * Lo común a una lista con filas.
 *
 * `basis` dice contra qué se compara: tramo contra tramo, con los dos
 * porcentajes, o el escalón contra lo que lleva quien mira (ADR 0051). Son
 * filas distintas y por eso tipos distintos: una fila sin `own` pintada con el
 * molde de la otra diría "0% en tu tramo", que no se ha medido.
 */
interface ListedBase {
  state: "listed";
  confidence: Extract<ConfidenceLevel, "high" | "medium">;
  /** El denominador del escalón objetivo: la base de los porcentajes de esta lista. */
  sample: number;
  /** Cuántos quedaron fuera del denominador por no tener el dato (regla 5). */
  unavailable: number;
}

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
 * La modalidad publicada de un bracket, o `undefined` si la web no la enseña.
 * Lo que el catálogo no sabe nombrar no tiene ni spec ni clase que pintar, y
 * adivinarlas partiendo el string por guiones es lo que prohíbe el ADR 0016.
 */
function publishedSlugOf(
  bracket: string,
  published: readonly BracketSlug[],
): BracketSlug | undefined {
  const slug = bracketSlugFor(bracket);
  return slug !== undefined && published.includes(slug) ? slug : undefined;
}

/**
 * Las specs que el personaje juega, por modalidad.
 *
 * Solo Shuffle primero y la arena después, cada una por rating: un 2100 de 3v3
 * y un 2100 de Solo Shuffle no son la misma cifra, y ordenarlos juntos haría que
 * la página abriese en una u otra modalidad según el día. La spec de arena es la
 * última que se le observó en ese bracket (ADR 0048); sin ninguna, la modalidad
 * no entra aquí y va a `unattributedBrackets`.
 */
export function observedSpecs(
  snapshots: readonly CharacterSnapshotRead[],
  options: ObservedSpecsOptions = {},
): ObservedSpec[] {
  const published = options.published ?? ["solo-shuffle"];
  const known = new Map((options.specs ?? []).map((entry) => [entry.bracket, entry]));

  return snapshots
    .flatMap((snapshot): ObservedSpec[] => {
      const bracketSlug = publishedSlugOf(snapshot.bracket, published);
      if (!bracketSlug) return [];

      if (!isArenaSlug(bracketSlug)) {
        const spec = parseShuffleBracket(snapshot.bracket);
        if (!spec) return [];
        const slug = specSlug(spec);
        return [{ ...base(snapshot, bracketSlug), slug, spec, specObservedAt: null }];
      }

      const observed = known.get(snapshot.bracket);
      const spec = observed ? findSpec(observed.classSlug, observed.specSlug) : undefined;
      if (!observed || !spec) return [];
      return [
        {
          ...base(snapshot, bracketSlug),
          slug: specSlug(spec),
          spec,
          specObservedAt: observed.observedAt,
        },
      ];
    })
    .sort(
      (a, b) =>
        BRACKET_SLUGS.indexOf(a.bracketSlug) - BRACKET_SLUGS.indexOf(b.bracketSlug) ||
        b.rating - a.rating ||
        a.slug.localeCompare(b.slug),
    );
}

function base(
  snapshot: CharacterSnapshotRead,
  bracketSlug: BracketSlug,
): Pick<ObservedSpec, "bracket" | "bracketSlug" | "rating"> {
  return { bracket: snapshot.bracket, bracketSlug, rating: snapshot.rating };
}

/**
 * Las modalidades de arena con rating y sin spec observada: solo el leaderboard
 * las ha visto. Van aparte porque no tienen página de spec que abrir, pero su
 * rating es un dato del personaje y se enseña.
 */
export function unattributedBrackets(
  snapshots: readonly CharacterSnapshotRead[],
  options: ObservedSpecsOptions = {},
): UnattributedBracket[] {
  const published = options.published ?? ["solo-shuffle"];
  const known = new Set((options.specs ?? []).map((entry) => entry.bracket));

  return snapshots.flatMap((snapshot) => {
    const bracketSlug = publishedSlugOf(snapshot.bracket, published);
    if (!bracketSlug || !isArenaSlug(bracketSlug) || known.has(snapshot.bracket)) return [];
    return [{ bracket: snapshot.bracket, bracketSlug, rating: snapshot.rating }];
  });
}

/**
 * Qué spec y qué modalidad abren la página.
 *
 * Por defecto la primera de `observedSpecs`: la de mayor rating de Solo Shuffle,
 * que es la que el jugador considera suya, y no la observada más recientemente:
 * esa cambiaría sola entre visitas y con ella cambiaría el sujeto de la
 * comparación. Lo pedido en la URL manda sobre el defecto. La spec sin modalidad
 * abre la primera modalidad en que la juega, y lo que este personaje no juega
 * **no es un 404**: la ruta identifica al personaje, no a la spec.
 */
export function pickSpec(
  specs: readonly ObservedSpec[],
  requested?: string,
  requestedBracket?: string,
): ObservedSpec | null {
  const asked = requested
    ? (specs.find((entry) => entry.slug === requested && entry.bracketSlug === requestedBracket) ??
      specs.find((entry) => entry.slug === requested))
    : undefined;
  return asked ?? specs[0] ?? null;
}

/**
 * Las filas que sostienen la caja, de entre las de una misma corrida: la del
 * tramo de quien mira y la del objetivo que le toca (ADR 0051).
 *
 * Lo usan las dos puntas —quien lee las adopciones y quien decide el estado— y
 * por eso es una función y no dos búsquedas: si eligieran objetivo por su
 * cuenta, la caja podría pintar los porcentajes de un escalón con la cabecera de
 * otro. Un tramo sin fila no tiene base, y eso es una respuesta y no un hueco
 * que rellenar con otra corrida.
 */
export function comparisonRowsFor(
  rating: number,
  segments: readonly SegmentRead[],
): {
  choice: ComparisonTarget;
  own: SegmentRead | null;
  target: SegmentRead | null;
  rowOf: (segment: RatingSegment) => SegmentRead | null;
} {
  const rowOf = (segment: RatingSegment): SegmentRead | null =>
    segments.find((row) => row.segment.id === segment.id) ?? null;
  const ownSegment = segmentFor(rating);
  const choice = comparisonTargetFor(
    ownSegment,
    (segment) => rowOf(segment)?.gear.denominator ?? 0,
  );
  const targetSegment = choice.mode === "none" ? choice.next : choice.segment;

  return {
    choice,
    own: rowOf(ownSegment),
    target: targetSegment ? rowOf(targetSegment) : null,
    rowOf,
  };
}

/**
 * El estado de la caja para un rating, con las filas de su spec y modalidad.
 *
 * Qué escalón es el objetivo lo decide `comparisonTargetFor()` con la base de
 * cada tramo, y el `n` que decide es siempre el `gear_sample`, nunca la
 * población (decisión 3 del ADR 0010): hay segmentos con miles de personas y
 * cero perfiles con equipo, y presentarlos como comparables es exactamente lo
 * que `canShowComparison()` existe para impedir.
 */
export function gapFor(input: {
  rating: number;
  /** Lo observado de quien mira: su item level, su equipo y sus nodos. */
  player: PlayerSide;
  /** Las filas de la spec y la modalidad, de una misma corrida. */
  segments: readonly SegmentRead[];
  /** Las adopciones del tramo propio y del objetivo, ya leídas. */
  adoptions: { gear: AdoptionSides; talentNodes: AdoptionSides };
}): GapView {
  const ownSegment = segmentFor(input.rating);
  const { choice, target, rowOf } = comparisonRowsFor(input.rating, input.segments);
  const targetSegment = choice.mode === "none" ? choice.next : choice.segment;
  // Sin objetivo y sin escalón encima es el tramo abierto sin base propia: no
  // falta muestra arriba, porque no hay arriba (§1.6).
  if (!targetSegment) return { state: "top-segment", ownSegment };

  const mode: ComparisonMode = choice.mode === "none" ? "next" : choice.mode;
  const population = target?.population.sampleSize ?? 0;
  const gearSample = target?.gear.denominator ?? 0;
  // Cualquiera de las procedencias de la fila sirve: las seis salen de la misma
  // corrida, y es esa fecha la que la caja tiene que poder enseñar.
  const computedAt = target?.gear.computedAt ?? null;
  // Sin nada observado de quien mira no hay comparación posible por muy
  // muestreado que esté el segmento objetivo, así que esta causa se mira antes
  // que las otras dos: es la única que señala a un lado de la comparación que
  // sí se puede arreglar consultando el perfil.
  const hasSubjectData = input.player.itemLevel !== null;

  // `!target` es redundante con `none` —un objetivo elegido tiene fila con
  // base— y va igualmente: es lo que deja `target` estrechado abajo, donde la
  // fecha de la corrida no puede faltar.
  if (choice.mode === "none" || !target || !hasSubjectData) {
    return {
      state: "insufficient",
      mode,
      ownSegment,
      targetSegment,
      computedAt,
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
  // Tramo contra tramo solo con el inmediato. Al saltar, el de abajo casi nunca
  // tiene base, y en `peers` no hay dos tramos: el otro lado es quien mira.
  const basis = mode === "next" ? "segments" : "player";
  return {
    state: "comparable",
    mode,
    ownSegment,
    targetSegment,
    skipped: choice.mode === "skipped" ? skippedSegments(choice.skipped, rowOf) : null,
    computedAt: target.gear.computedAt,
    // El `insufficient` ya salió arriba; el tipo lo estrecha aquí para que la
    // caja no tenga que volver a preguntarse por un estado imposible.
    confidence: confidence === "high" ? "high" : "medium",
    gearSample,
    itemLevel: itemLevelComparison(input.player.itemLevel, target),
    overlap:
      input.player.gear === null
        ? null
        : gearOverlap(items, input.adoptions.gear.target.map(toAggregatedVariable)),
    gear: listFor({ ...input.adoptions.gear, basis, playerKeys: gearKeys(input.player.gear) }),
    talents: listFor({
      ...input.adoptions.talentNodes,
      basis,
      playerKeys: talentKeys(input.player.talents),
    }),
  };
}

function skippedSegments(
  segments: readonly RatingSegment[],
  rowOf: (segment: RatingSegment) => SegmentRead | null,
): SkippedSegments | null {
  const first = segments[0];
  const last = segments[segments.length - 1];
  if (!first || !last) return null;

  const rows = segments.map(rowOf);
  return {
    first,
    last,
    count: segments.length,
    population: rows.reduce((sum, row) => sum + (row?.population.sampleSize ?? 0), 0),
    gearSample: rows.reduce((sum, row) => sum + (row?.gear.denominator ?? 0), 0),
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

/**
 * Lo mismo para los talentos, con la clave de `talentSelectionKey()`.
 *
 * Por el talento elegido y no por el nodo (ADR 0044): con la clave del nodo,
 * quien eligió Freezing Cold salía marcado como que ya lleva el Ice Nova que
 * lleva el segmento, porque los dos cuelgan del 62087.
 */
export function talentKeys(talents: CharacterTalentsRead | null): ReadonlySet<string> | null {
  if (talents === null) return null;
  return new Set(talents.nodes.map(talentSelectionKey));
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
 * `basis` dice cuál es el otro lado. En `segments` es el tramo propio, y la
 * fila dice los dos porcentajes, así que los dos necesitan base. En `player` es
 * lo que lleva quien mira (ADR 0051), y lo que necesita es haberlo leído: sin
 * su equipo, "lo que llevan ahí y tú no" sería la lista entera del escalón.
 *
 * Una lista **vacía no es un fallo**: significa que ninguna variable supera el
 * umbral discriminante, y §13.5 dice que las diferencias pequeñas se ocultan en
 * vez de rellenar el hueco. Quien la pinta lo dice con esas palabras.
 */
export function listFor(input: {
  basis: "segments" | "player";
  own: readonly AdoptionRead[];
  target: readonly AdoptionRead[];
  playerKeys: ReadonlySet<string> | null;
}): ListView {
  const targetSample = input.target[0]?.provenance.denominator ?? 0;
  const ownSample = input.own[0]?.provenance.denominator ?? 0;

  // El objetivo se mira primero porque es el que describe la lista entera: si
  // ahí no hay base, no hay nada que contar del escalón.
  if (!canShowComparison(targetSample)) {
    return {
      state: "insufficient",
      missing: "target",
      sample: targetSample,
      needed: MIN_SAMPLE_MEDIUM,
    };
  }

  const iconsByKey = new Map(input.target.map((row) => [row.variableKey, row.iconUrl]));
  const iconOf = (key: string): string | null => iconsByKey.get(key) ?? null;
  const confidence = confidenceFor(targetSample);
  const listed = {
    state: "listed",
    confidence: confidence === "high" ? "high" : "medium",
    sample: targetSample,
    // De la fila del objetivo, que es la que sostiene los porcentajes que se
    // leen como "lo que lleva el escalón".
    unavailable: input.target[0]?.unavailable ?? 0,
  } as const;

  if (input.basis === "player") {
    if (input.playerKeys === null) {
      return { state: "insufficient", missing: "player", sample: 0, needed: MIN_SAMPLE_MEDIUM };
    }
    const differences = playerDifferences(
      input.playerKeys,
      input.target.map(toAggregatedVariable),
    ).map((difference) => ({ ...difference, iconUrl: iconOf(difference.variable.key) }));
    return { ...listed, basis: "player", differences };
  }

  if (!canShowComparison(ownSample)) {
    return { state: "insufficient", missing: "own", sample: ownSample, needed: MIN_SAMPLE_MEDIUM };
  }

  const differences = biggestDifferences(
    input.own.map(toAggregatedVariable),
    input.target.map(toAggregatedVariable),
  ).map((difference) => ({
    ...difference,
    playerHasIt: input.playerKeys?.has(difference.variable.key) ?? false,
    iconUrl: iconOf(difference.variable.key),
  }));

  return { ...listed, basis: "segments", differences };
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
  /**
   * En arena la posición cuenta el bracket entero, todas las specs: su
   * leaderboard no trae spec, y por spec solo contaría a quien tiene perfil
   * (ADR 0048). Los tamaños de segmento, que sí son de la spec, no se ponen al
   * lado: sumarían una población por spec bajo una frase sobre el bracket.
   */
  wholeBracket?: boolean;
}): StandingView {
  const ownSegment = segmentFor(input.rating);
  const targetSegment = nextSegment(ownSegment);
  const find = (segment: RatingSegment | undefined): SegmentRead | undefined =>
    !input.wholeBracket && segment
      ? input.segments.find((row) => row.segment.id === segment.id)
      : undefined;

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
