import { BRACKET_LABELS, BRACKET_SLUGS, HOME_PATH, type ActivityWindowDays } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { BracketPopulationList } from "../../components/bracket-population-list";
import { CharacterSearch } from "../../components/character-search";
import { RecentSearches } from "../../components/recent-searches";
import { SpecRepresentationTable } from "../../components/spec-representation-table";
import { Card } from "../../components/ui/card";
import { copyFor } from "../../i18n/copy";
import { alternatesFor } from "../../i18n/alternates";
import { formatCount, formatRating } from "../../i18n/format";
import { isLocale, type Locale } from "../../i18n/locales";
import { loadHomeData, type HomeScope } from "../../server/home";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  // Sin `title`: la portada se queda con el `default` del layout, que es el
  // nombre a secas. Repetirlo aquí lo pasaría por la plantilla y saldría dos
  // veces.
  return {
    description: copyFor(locale).site.tagline,
    alternates: alternatesFor(HOME_PATH, locale),
  };
}

/**
 * El encabezado de un bloque de la portada: el título y, al lado, el ámbito de
 * lo que hay debajo.
 *
 * El ámbito va pegado al título y no dentro de la tarjeta porque acota lo que se
 * afirma —la modalidad, la región y la temporada—, y una cifra sin ámbito se lee
 * como si valiera para todo el juego.
 */
function SectionHeading({ title, scope }: { title: string; scope?: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
      <h2 className="text-foreground tracking-caps text-xl uppercase">{title}</h2>
      {scope !== undefined && <span className="text-subtle-foreground text-sm">{scope}</span>}
    </div>
  );
}

/**
 * Lo que va donde iría una lectura que no hay.
 *
 * Existe como componente y no como un `<p>` suelto porque lo que declara no es
 * "cargando": es que **esa lectura no está**, y la §1.5 del brief pide decir con
 * palabras lo que falta en vez de dejar el hueco. La regla de no bajar umbrales
 * para llenar pantalla se incumple igual llenándola con cifras de ejemplo.
 *
 * Discontinuo y no una `Alert`: `Alert` lleva `role="alert"`, que es una región
 * viva y anuncia lo que hay dentro como si acabara de pasar algo. Aquí no ha
 * pasado nada — esa lectura no está publicada, y lo estaba igual antes de
 * entrar.
 */
function MissingCard({ children }: { children: ReactNode }) {
  return (
    <Card className="text-muted-foreground border-dashed p-5 text-sm shadow-none">{children}</Card>
  );
}

/**
 * El ámbito del bloque de la modalidad: `Solo Shuffle · EU · temporada 42`.
 *
 * La temporada la dice la corrida, así que sin corrida no se escribe ninguna: un
 * "temporada 42" heredado de otra cosa afirmaría de qué temporada son unas
 * cifras que no están.
 */
function metaScope(scope: HomeScope, locale: Locale): string {
  const [bracket] = BRACKET_SLUGS;
  return [BRACKET_LABELS[bracket], ...whereAndWhen(scope, locale)].join(" · ");
}

/**
 * El ámbito del bloque de población: `EU · temporada 42 · últimos 7 días`.
 *
 * Sin modalidad delante, al contrario que el de arriba: este bloque habla de las
 * cinco. Y con la ventana al final, que es lo que acota la cifra — un recuento
 * de gente sin decir de cuántos días es se lee como "toda la que hay".
 */
function populationScope(scope: HomeScope, windowDays: ActivityWindowDays, locale: Locale): string {
  const window = copyFor(locale).home.population.window(formatCount(windowDays, locale));
  return [...whereAndWhen(scope, locale), window].join(" · ");
}

/** Región y temporada, que las dicen igual los dos bloques. */
function whereAndWhen(scope: HomeScope, locale: Locale): string[] {
  const parts = [scope.region.toUpperCase()];
  if (scope.seasonId !== null) {
    parts.push(copyFor(locale).spec.season(formatRating(scope.seasonId, locale)));
  }
  return parts;
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = copyFor(locale);
  const { scope, meta, population } = await loadHomeData();

  // El buscador es lo que §23 pone en el centro de la portada, encima de todo
  // lo demás: es la única puerta al producto, porque sin personaje no hay ni
  // perfil ni Player Gap que enseñar. Lo que va debajo describe la población
  // sobre la que se compara, y por eso va debajo y no al lado.
  return (
    <main className="mx-auto flex max-w-page flex-col gap-10 px-5 py-10 lg:px-8 lg:py-12">
      <div className="flex flex-col gap-3">
        {/*
         * El acento marca la parte del titular que dice de qué va el producto, y
         * lo hace **sin ser lo único que la marca**: la frase se entiende igual
         * leída entera y en un solo color. La partición viene del diccionario,
         * porque en cada lengua la parte que importa cae en otro sitio.
         */}
        <h1 className="text-foreground tracking-caps text-3xl uppercase">
          {copy.home.title.lead} <span className="text-primary">{copy.home.title.highlight}</span>
        </h1>
        <p className="text-muted-foreground max-w-measure text-lg">{copy.home.subtitle}</p>
      </div>

      <CharacterSearch locale={locale} region={scope.region} />

      <RecentSearches locale={locale} region={scope.region} />

      <section className="flex flex-col gap-3">
        <SectionHeading title={copy.home.meta.title} scope={metaScope(scope, locale)} />
        {meta.state === "listed" ? (
          <SpecRepresentationTable locale={locale} board={meta.board} />
        ) : (
          <MissingCard>
            {meta.state === "empty" ? copy.home.meta.empty : copy.home.meta.unavailable}
          </MissingCard>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <SectionHeading
          title={copy.home.population.title}
          /*
           * La ventana solo se nombra cuando hay cifra que acotar: escribir
           * "últimos 7 días" encima de una ausencia acotaría algo que no se ha
           * contado.
           */
          {...(population.state === "counted"
            ? { scope: populationScope(scope, population.windowDays, locale) }
            : {})}
        />
        {population.state === "counted" ? (
          <BracketPopulationList
            locale={locale}
            active={population.active}
            computedAt={population.computedAt}
            windowDays={population.windowDays}
          />
        ) : (
          <MissingCard>
            {population.state === "empty"
              ? copy.home.population.empty
              : copy.home.population.unavailable}
          </MissingCard>
        )}
      </section>

      <p className="text-subtle-foreground max-w-measure text-xs">{copy.home.lead}</p>
    </main>
  );
}
