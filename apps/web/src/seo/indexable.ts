import {
  BRACKET_SLUGS,
  type BracketSlug,
  type RatingSegment,
  type SpecEntry,
  parseSegmentSlug,
  parseShuffleBracket,
  specPath,
} from "@wowpvp/core";
import { isComparable, type SegmentSampleRead } from "@wowpvp/data";
import type { Metadata } from "next";

import { type Environment, isPublicSite } from "../site";

/**
 * Si las páginas de `/spec/…` ya enseñan algo.
 *
 * Hoy los tres niveles renderizan `PagePlaceholder`: tienen dirección y no
 * tienen contenido. La regla de muestra del ADR 0029 es condición necesaria y
 * no suficiente, así que mientras esto sea `false` ninguna ruta de spec entra
 * en el índice ni en el sitemap, por muy poblado que esté el escalón.
 *
 * La enciende #99, que es quien pone el contenido. Lo hace aquí y no en cada
 * página para que sea una línea y no cuatro.
 */
export const SPEC_PAGES_PUBLISHED = false;

/**
 * Una página de segmento es indexable si alguna de sus tres bases de
 * comparación llega al umbral de §13.4 (ADR 0029, decisión 2).
 *
 * "Alguna" y no "la de gear" porque las tres son contenido propio y llegan en
 * momentos distintos —los nodos empiezan a contar en la migración 0012—, y la
 * población deliberadamente no cuenta: un escalón de 3.000 personas del que no
 * sabemos el equipo de nadie no tiene nada que enseñar que no diga ya la página
 * de arriba (ADR 0011, decisión 9).
 */
export function isSegmentIndexable(sample: SegmentSampleRead): boolean {
  return (
    isComparable(sample.gear) || isComparable(sample.talentNodes) || isComparable(sample.pvpTalents)
  );
}

/** Una URL publicable, con la fecha del dato que la sostiene. */
export interface IndexableRoute {
  /** Ruta sin prefijo de locale, tal como la construye `@wowpvp/core`. */
  path: string;
  lastModified: Date;
}

interface SegmentTarget {
  bracket: BracketSlug;
  segment: RatingSegment;
  spec: SpecEntry;
}

/**
 * De qué ruta habla una fila de `population_segments`.
 *
 * La columna `bracket` es la de Blizzard (`shuffle-mage-frost`) y el tramo de la
 * URL es la modalidad (`solo-shuffle`): el puente en este sentido es
 * `parseShuffleBracket`, y el catálogo decide si existe. Una fila de un bracket
 * que no esté en `ALL_SPECS` —el agregado de Solo Shuffle, una spec nueva— no
 * tiene página, y se descarta en vez de inventarle una.
 */
function targetFor(sample: SegmentSampleRead): SegmentTarget | undefined {
  const spec = parseShuffleBracket(sample.bracket);
  const segment = parseSegmentSlug(sample.segmentId);
  if (!spec || !segment) return undefined;

  // Solo Shuffle es la única modalidad publicada (§25); el día que haya otra,
  // la fila dirá de cuál es y esto dejará de ser una constante.
  const [bracket] = BRACKET_SLUGS;
  return { bracket, segment, spec };
}

/**
 * Las rutas de `/spec/…` que la muestra respalda, en sus tres niveles.
 *
 * Un bracket y una spec se publican si al menos uno de los escalones que
 * cuelgan de ellos lo hace (ADR 0029, decisión 3): su contenido es el resumen de
 * lo que hay debajo, así que sin un solo escalón servible no tienen resumen que
 * dar. La fecha que hereda cada nivel es la más reciente de los suyos.
 *
 * Está separada de `indexableSpecRoutes` para que la parte que decide qué URL
 * existen se pueda probar hoy, con el armazón todavía sin encender.
 */
export function specRoutesWithSample(samples: readonly SegmentSampleRead[]): IndexableRoute[] {
  const byPath = new Map<string, Date>();
  const record = (path: string, at: Date): void => {
    const known = byPath.get(path);
    if (!known || at > known) byPath.set(path, at);
  };

  for (const sample of samples) {
    if (!isSegmentIndexable(sample)) continue;

    const target = targetFor(sample);
    if (!target) continue;

    const { spec, bracket, segment } = target;
    const at = sample.gear.computedAt;
    record(specPath(spec), at);
    record(specPath(spec, bracket), at);
    record(specPath(spec, bracket, segment), at);
  }

  return [...byPath]
    .map(([path, lastModified]) => ({ path, lastModified }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

/** Lo anterior, más la condición de que la página exista de verdad. */
export function indexableSpecRoutes(samples: readonly SegmentSampleRead[]): IndexableRoute[] {
  return SPEC_PAGES_PUBLISHED ? specRoutesWithSample(samples) : [];
}

/**
 * La única puerta por la que una página declara si se indexa.
 *
 * Multiplica por el entorno en vez de sumarse a él: el `layout` pone `noindex`
 * fuera de producción, y Next deja que el `robots` de una página pise el del
 * layout entero. Una página que devolviera `{ index: true }` por su cuenta
 * publicaría cada preview en Google (ADR 0029, decisión 7).
 */
export function robotsFor(indexable: boolean, env: Environment): NonNullable<Metadata["robots"]> {
  const allowed = indexable && isPublicSite(env);
  return { index: allowed, follow: allowed };
}
