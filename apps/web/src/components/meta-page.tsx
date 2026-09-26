import { BRACKET_LABELS, metaPath, type BracketSlug } from "@wowpvp/core";
import type { Metadata } from "next";

import { alternatesFor } from "../i18n/alternates";
import { copyFor } from "../i18n/copy";
import { formatRating } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import { robotsFor } from "../seo/indexable";
import { isMetaIndexable, type MetaData, type MetaScope } from "../server/meta";
import { SpecRepresentationTable } from "./spec-representation-table";
import { Badge } from "./ui/badge";
import { Card } from "./ui/card";

/**
 * `/meta/{modalidad}`: el reparto de una modalidad entre sus cuarenta specs
 * (ADR 0038).
 *
 * Es la página que la portada recorta. Lo que añade sobre aquellas ocho filas
 * son las treinta y dos restantes y el tramo mediano de cada una, que es la
 * `rating_distribution` de la §17 dicha por spec en vez de spec a spec.
 *
 * **No hay letras ni orden por índice.** La §17 empieza prohibiendo la tier
 * list, y el índice es la cifra más fácil de leer como una: ordenar por él
 * convertiría una proporción descriptiva en un ranking de lo bueno que es algo
 * (regla 3). El orden es la población, y los empates los deshace la etiqueta.
 *
 * Sin migas de pan, como la metodología: es una página de primer nivel y una
 * miga de un solo escalón no sitúa a nadie.
 */
export async function metaMetadata(bracket: BracketSlug, locale: Locale): Promise<Metadata> {
  const copy = copyFor(locale).meta;
  return {
    title: copy.title(BRACKET_LABELS[bracket]),
    description: copy.lead,
    alternates: alternatesFor(metaPath(bracket), locale),
    // Sin reparto no hay contenido, y una dirección sin contenido no se indexa
    // (ADR 0029). Es la misma condición que decide qué se pinta.
    robots: robotsFor(await isMetaIndexable(bracket), process.env),
  };
}

/** Región y temporada, dichas igual que en la portada y en las páginas de spec. */
function scopeLabel(scope: MetaScope, locale: Locale): string | null {
  if (scope.seasonId === null) return null;
  const season = copyFor(locale).spec.season(formatRating(scope.seasonId, locale));
  return `${season} · ${scope.region.toUpperCase()}`;
}

export function MetaPage({ locale, data }: { locale: Locale; data: MetaData }) {
  const copy = copyFor(locale);
  const { scope, board } = data;
  const bracketLabel = BRACKET_LABELS[scope.bracket];
  const scoped = scopeLabel(scope, locale);

  return (
    <main className="mx-auto flex max-w-page flex-col gap-8 px-5 py-10 lg:px-8 lg:py-12">
      <header className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <h1 className="text-foreground text-2xl">{copy.meta.title(bracketLabel)}</h1>
          <p className="text-muted-foreground max-w-measure text-base">{copy.meta.lead}</p>
        </div>

        {/*
         * La temporada solo se escribe si la dice una corrida: heredarla de otra
         * cosa afirmaría de qué temporada son unas cifras que no están.
         */}
        {scoped !== null && (
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">{scoped}</Badge>
          </div>
        )}
      </header>

      {board === null ? (
        /*
         * Discontinuo y sin `role="alert"`, como en la portada: no ha pasado
         * nada, esa corrida no tiene a nadie y lo estaba igual antes de entrar.
         */
        <Card className="text-muted-foreground border-dashed p-5 text-sm shadow-none">
          {copy.meta.empty(bracketLabel)}
        </Card>
      ) : (
        <>
          <SpecRepresentationTable locale={locale} board={board} showMedian />
          {/*
           * El tope del leaderboard va con la distribución y no con el reparto:
           * es el corte que decide a quién llegamos a ver, y es la misma frase
           * que dicen la tabla por tramo y el bloque de posición del perfil.
           */}
          <p className="text-subtle-foreground max-w-measure text-xs">{copy.spec.ladderCap}</p>
        </>
      )}
    </main>
  );
}
