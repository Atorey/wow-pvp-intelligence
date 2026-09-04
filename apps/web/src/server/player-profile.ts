import {
  MIN_SAMPLE_MEDIUM,
  canShowComparison,
  confidenceFor,
  nextSegment,
  parseShuffleBracket,
  segmentFor,
  specSlug,
  type ConfidenceLevel,
  type RatingSegment,
  type SpecEntry,
} from "@wowpvp/core";
import type { CharacterSnapshotRead, SegmentRead, StandingRead } from "@wowpvp/data";

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
  playerItemLevel: number | null;
  /** La fila del segmento objetivo, o null si esa corrida no lo calculó. */
  target: SegmentRead | null;
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
  const hasSubjectData = input.playerItemLevel !== null;

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
  return {
    state: "comparable",
    ownSegment,
    targetSegment,
    // El `insufficient` ya salió arriba; el tipo lo estrecha aquí para que la
    // caja no tenga que volver a preguntarse por un estado imposible.
    confidence: confidence === "high" ? "high" : "medium",
    gearSample,
    itemLevel: itemLevelComparison(input.playerItemLevel, input.target),
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
