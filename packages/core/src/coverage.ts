import { canShowComparison, confidenceFor } from "./confidence";
import {
  DEFAULT_SEGMENT_SCALE,
  nextSegment,
  segmentFor,
  servesIcpSubjects,
  type SegmentScale,
} from "./segments";
import type { ActivityWindowDays, ConfidenceLevel, RatingSegment } from "./types";

/**
 * Cobertura servible por par `(spec, segmento objetivo)` (ADR 0010, decisión 2).
 *
 * Una spec no "está" o "no está": tiene Player Gap allí donde el escalón de
 * arriba llega a muestra, y no lo tiene en el resto. Y ese escalón de arriba se
 * mueve durante la temporada —sube según madura la ladder y se desploma en cada
 * reinicio—, así que la cobertura no es un hecho que se apunte una vez: es una
 * serie (ADR 0032).
 *
 * Vive en core y no en el job que la calcula por lo mismo que `servesIcpSubjects`:
 * es una regla de producto. De aquí sale qué se le puede enseñar a un jugador y
 * qué no, y la única puerta sigue siendo `canShowComparison()` sobre el
 * `gear_sample` del objetivo — nunca sobre su población, que es otra cifra y
 * difiere en órdenes de magnitud (ADR 0010, decisión 3).
 */

/** Lo que aporta un escalón ya agregado a la cuenta de cobertura. */
export interface SegmentCoverageInput {
  bracket: string;
  classSlug: string;
  specSlug: string;
  /**
   * Suelo del tramo. La escala es un parámetro y cambia por temporada, así que
   * el tramo se reconstruye preguntándole a `segmentFor` en vez de partir el id.
   */
  segmentMin: number;
  /** Población activa del escalón. */
  sampleSize: number;
  /** Su base de comparación real: con cuántos de ellos hay gear legible. */
  gearSample: number;
  /** Ventana con la que se contó el escalón (§13.4). Parte de la definición del número. */
  activityWindowDays: ActivityWindowDays;
}

/**
 * Un par ya resuelto: quién mira, contra qué escalón, y con qué denominadores.
 *
 * El objetivo puede no existir, y ese es justo el caso interesante:
 * `population_segments` no escribe filas de escalones vacíos, así que "encima de
 * estos 400 sujetos no hay nadie" solo se puede leer como una ausencia. Aquí se
 * escribe con ceros.
 */
export interface CoveragePair {
  bracket: string;
  classSlug: string;
  specSlug: string;
  /** Escalón de los sujetos: desde dónde se mira. */
  subject: RatingSegment;
  /** Cuántos hay, con la ventana de su propia fila. */
  subjects: number;
  /** Escalón objetivo: contra qué se compara (§13.1 del plan). */
  target: RatingSegment;
  /** Población del objetivo. 0 = no hay nadie ahí arriba, no "no se miró". */
  targetSampleSize: number;
  /** Base de comparación del objetivo. Es la que decide si el par se sirve. */
  targetGearSample: number;
  /** Ventana con la que se contó el objetivo. null cuando el objetivo no tiene fila. */
  targetWindow: ActivityWindowDays | null;
}

function pairKey(bracket: string, segmentId: string): string {
  return `${bracket}|${segmentId}`;
}

/**
 * Empareja cada escalón con el inmediatamente superior.
 *
 * Solo se emiten pares con sujetos: un objetivo poblado sin nadie debajo no le
 * sirve a ningún jugador (ADR 0010, decisión 5), y contarlo como cobertura
 * convertiría el fondo de la ladder en una métrica tranquilizadora. El tramo
 * abierto de arriba tampoco emite par, porque no tiene contra qué compararse
 * (§13.5 del plan).
 */
export function buildCoverage(
  segments: readonly SegmentCoverageInput[],
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): CoveragePair[] {
  const byKey = new Map<string, SegmentCoverageInput>();
  for (const segment of segments) {
    byKey.set(pairKey(segment.bracket, segmentFor(segment.segmentMin, scale).id), segment);
  }

  const pairs: CoveragePair[] = [];
  for (const segment of segments) {
    if (segment.sampleSize === 0) continue;

    const subject = segmentFor(segment.segmentMin, scale);
    const target = nextSegment(subject, scale);
    if (!target) continue;

    const above = byKey.get(pairKey(segment.bracket, target.id));
    pairs.push({
      bracket: segment.bracket,
      classSlug: segment.classSlug,
      specSlug: segment.specSlug,
      subject,
      subjects: segment.sampleSize,
      target,
      targetSampleSize: above?.sampleSize ?? 0,
      targetGearSample: above?.gearSample ?? 0,
      targetWindow: above?.activityWindowDays ?? null,
    });
  }

  return pairs.sort((a, b) => a.bracket.localeCompare(b.bracket) || a.subject.min - b.subject.min);
}

/**
 * Las dos confianzas del par, que no son la misma y por eso van separadas.
 *
 * `population` describe cuánta gente hay en el objetivo; `gear`, con cuánta de
 * ella se puede comparar. Enseñar la primera como si fuera la segunda es el
 * error que `population_segments.confidence` guardó mientras existió: filas
 * `high` con `gear_sample = 0`, que es población de sobra y ni un perfil con el
 * que comparar. Esa columna ya no está (ADR 0033); la lección, sí.
 */
export function coverageConfidence(pair: CoveragePair): {
  population: ConfidenceLevel;
  gear: ConfidenceLevel;
} {
  return {
    population: confidenceFor(pair.targetSampleSize),
    gear: confidenceFor(pair.targetGearSample),
  };
}

/** ¿Se puede pintar hoy el Player Gap de este par? La puerta es siempre la misma. */
export function isServiceable(pair: CoveragePair): boolean {
  return canShowComparison(pair.targetGearSample);
}

/**
 * ¿Llegaría el par a servirse solo con bajar perfiles?
 *
 * Es la distancia entre "no hay a quién muestrear" y "no lo hemos muestreado":
 * lo primero no lo arregla ninguna cuota, lo segundo es exactamente lo que gasta
 * `refresh-profiles`.
 */
export function hasPopulatedTarget(pair: CoveragePair): boolean {
  return canShowComparison(pair.targetSampleSize);
}

/** La cobertura de un escalón, contada en specs y en personas. */
export interface CoverageRollup {
  subject: RatingSegment;
  target: RatingSegment;
  /** Si estos sujetos son del público objetivo (§4 del plan). */
  servesIcp: boolean;
  /** Specs con sujetos en este escalón. */
  pairs: number;
  /** De ellas, en cuántas el objetivo llega a muestra de población. */
  populatedTargets: number;
  /** Y en cuántas se puede servir hoy la comparación. */
  serviceablePairs: number;
  subjects: number;
  subjectsWithPopulatedTarget: number;
  /** Personas a las que hoy se les podría enseñar un Player Gap. */
  subjectsServed: number;
}

/**
 * Agrupa los pares por escalón del sujeto: la forma en que se lee la cobertura.
 *
 * Se cuenta dos veces, en specs y en personas, porque responden a preguntas
 * distintas y ninguna sustituye a la otra: "21 specs servibles" no dice a cuánta
 * gente alcanzan, y "1.774 sujetos con objetivo" no dice si están repartidos o
 * si son todos del mismo bracket.
 */
export function rollUpCoverage(
  pairs: readonly CoveragePair[],
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): CoverageRollup[] {
  const bySubject = new Map<string, CoverageRollup>();

  for (const pair of pairs) {
    let rollup = bySubject.get(pair.subject.id);
    if (!rollup) {
      rollup = {
        subject: pair.subject,
        target: pair.target,
        // Se pregunta por el objetivo y no por el sujeto porque es la misma
        // pregunta: `servesIcpSubjects` mira justo el escalón de debajo, que es
        // este. Así el ICP se sigue decidiendo en un único sitio.
        servesIcp: servesIcpSubjects(pair.target, scale),
        pairs: 0,
        populatedTargets: 0,
        serviceablePairs: 0,
        subjects: 0,
        subjectsWithPopulatedTarget: 0,
        subjectsServed: 0,
      };
      bySubject.set(pair.subject.id, rollup);
    }

    rollup.pairs++;
    rollup.subjects += pair.subjects;
    if (hasPopulatedTarget(pair)) {
      rollup.populatedTargets++;
      rollup.subjectsWithPopulatedTarget += pair.subjects;
    }
    if (isServiceable(pair)) {
      rollup.serviceablePairs++;
      rollup.subjectsServed += pair.subjects;
    }
  }

  return [...bySubject.values()].sort((a, b) => a.subject.min - b.subject.min);
}
