import { getRegion } from "@wowpvp/blizzard";
import {
  BRACKET_SLUGS,
  bracketIdFor,
  specPath,
  type BracketSlug,
  type Region,
  type SpecRoute,
} from "@wowpvp/core";
import {
  GEAR_KINDS,
  type AdoptionRead,
  type RunPopulationRead,
  type SegmentRead,
} from "@wowpvp/data";
import { connection } from "next/server";

import { isSpecPathIndexable } from "../seo/indexable";
import {
  cachedAdoptionFor,
  cachedBracketSegments,
  cachedRunPopulation,
  cachedSegmentSamples,
} from "./aggregate-cache";
import { getDb } from "./db";
import "./env";
import {
  segmentDetailFor,
  specOverviewFor,
  type SegmentDetail,
  type SpecOverview,
} from "./spec-view";

/**
 * Lo que las páginas de spec necesitan de Postgres.
 *
 * Las lecturas son de `@wowpvp/data` y no hay SQL aquí (ADR 0014): este módulo
 * decide cuáles se piden y en qué orden. Todas pasan por la caché de proceso,
 * porque son iguales para todo el que mire esa spec y cambian una vez al día
 * (ADR 0031). Lo que se decide con los datos ya cargados vive en `spec-view.ts`.
 */

/** Dónde se sitúa lo que enseña la página. */
export interface SpecScope {
  region: Region;
  /** La temporada de la última corrida, o `null` si la región no tiene ninguna. */
  seasonId: number | null;
  bracket: BracketSlug;
}

/**
 * La modalidad de la página. La de spec a secas no nombra ninguna y enseña la
 * única publicada, que es lo mismo que su página de modalidad (§25): son la
 * misma vista hasta que haya una segunda.
 */
function bracketOf(route: SpecRoute): BracketSlug {
  const [only] = BRACKET_SLUGS;
  return route.bracket ?? only;
}

async function loadSegments(route: SpecRoute): Promise<{
  scope: SpecScope;
  run: RunPopulationRead | null;
  segments: SegmentRead[];
}> {
  // En petición y no al construir, como el sitemap: el dato es el de la
  // corrida de esta madrugada, y el build de CI no tiene secretos con los que
  // abrir Postgres.
  await connection();

  const db = getDb();
  const region = getRegion();
  const bracket = bracketOf(route);

  // La temporada la dice la última corrida de la región y no Blizzard:
  // preguntársela cuesta cuota en cada visita, y lo que la página enseña es lo
  // último que se ha calculado.
  const run = await cachedRunPopulation(db, region);
  if (!run) return { scope: { region, seasonId: null, bracket }, run, segments: [] };

  const segments = await cachedBracketSegments(db, {
    region,
    seasonId: run.seasonId,
    bracket: bracketIdFor(bracket, route.spec),
  });
  return { scope: { region, seasonId: run.seasonId, bracket }, run, segments };
}

export interface SpecOverviewData {
  scope: SpecScope;
  /** `null` si en esa modalidad no consta nadie observado de la spec. */
  overview: SpecOverview | null;
}

export async function loadSpecOverview(route: SpecRoute): Promise<SpecOverviewData> {
  const { scope, run, segments } = await loadSegments(route);
  return {
    scope,
    overview: specOverviewFor({
      bracket: bracketIdFor(scope.bracket, route.spec),
      segments,
      run,
    }),
  };
}

export interface SegmentPageData {
  scope: SpecScope;
  /** `null` si la corrida no tiene a nadie observado en ese tramo. */
  detail: SegmentDetail | null;
  /** De qué corrida es lo que se enseña, o de cuál es la ausencia. */
  computedAt: Date | null;
}

export async function loadSegmentPage(route: SpecRoute): Promise<SegmentPageData> {
  const { scope, run, segments } = await loadSegments(route);
  const row = segments.find((entry) => entry.segment.id === route.segment?.id);

  // Sin fila, o con una fila sin nadie, no hay escalón que describir. Lo que sí
  // hay es una fecha: la ausencia es de una corrida concreta, y se dice cuál.
  if (!row || row.population.sampleSize === 0) {
    return {
      scope,
      detail: null,
      computedAt: segments[0]?.gear.computedAt ?? run?.computedAt ?? null,
    };
  }

  const db = getDb();
  // Cuatro lecturas porque son cuatro bases: las tres variables de gear
  // comparten la suya y van juntas (ADR 0027), pero nodos, árbol de héroe y
  // talentos PvP tienen cada uno su denominador, y pedirlos a la vez mezclaría
  // en una lista porcentajes calculados sobre gente distinta.
  const [gear, talentNodes, heroTrees, pvpTalents] = await Promise.all([
    cachedAdoptionFor(db, [row], GEAR_KINDS),
    cachedAdoptionFor(db, [row], "talent-node"),
    cachedAdoptionFor(db, [row], "hero-tree"),
    cachedAdoptionFor(db, [row], "pvp-talent"),
  ]);
  const own = (byRowId: Map<string, AdoptionRead[]>): AdoptionRead[] =>
    byRowId.get(row.rowId) ?? [];

  return {
    scope,
    detail: segmentDetailFor({
      segment: row,
      adoptions: {
        gear: own(gear),
        talentNodes: own(talentNodes),
        heroTrees: own(heroTrees),
        pvpTalents: own(pvpTalents),
      },
    }),
    computedAt: row.gear.computedAt,
  };
}

/**
 * Si una ruta de spec se indexa, con la misma lectura que usa el sitemap.
 *
 * Una lectura que falla aquí no puede tumbar la página: `generateMetadata`
 * corre fuera de todo boundary, y una excepción suya se salta el `error.tsx`.
 * Sin muestra que la respalde, la respuesta es la misma que para una ruta sin
 * ella: no se indexa. El render vuelve a leer, y si falla lo recoge el boundary.
 */
export async function isSpecRouteIndexable(route: SpecRoute): Promise<boolean> {
  try {
    const samples = await cachedSegmentSamples(getDb());
    return isSpecPathIndexable(specPath(route.spec, route.bracket, route.segment), samples);
  } catch {
    return false;
  }
}
