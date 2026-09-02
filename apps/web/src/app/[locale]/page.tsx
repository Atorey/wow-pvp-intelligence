import { getRegion } from "@wowpvp/blizzard";
import { BRACKET_LABELS, HOME_PATH } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { CharacterSearch } from "../../components/character-search";
import { RecentSearches } from "../../components/recent-searches";
import { Card } from "../../components/ui/card";
import { copyFor } from "../../i18n/copy";
import { alternatesFor } from "../../i18n/alternates";
import { isLocale } from "../../i18n/locales";

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
 * Una sección de datos que todavía no lee de Postgres.
 *
 * Existe como componente y no como un `<p>` suelto porque son dos y van a ser
 * más, y porque lo que declara no es "cargando": es que **esa lectura no está
 * publicada**. La §1.5 del brief pide decir con palabras lo que falta en vez de
 * dejar el hueco, y la regla de no bajar umbrales para llenar pantalla se
 * incumple igual llenándola con cifras de ejemplo.
 */
function PendingSection({
  title,
  scope,
  children,
}: {
  title: string;
  scope?: string;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-foreground tracking-caps text-xl uppercase">{title}</h2>
        {scope !== undefined && <span className="text-subtle-foreground text-sm">{scope}</span>}
      </div>
      {/*
       * Discontinuo y no una `Alert`: `Alert` lleva `role="alert"`, que es una
       * región viva y anuncia lo que hay dentro como si acabara de pasar algo.
       * Aquí no ha pasado nada — esa lectura todavía no está publicada, y lo
       * estaba igual antes de entrar.
       */}
      <Card className="text-muted-foreground border-dashed p-5 text-sm shadow-none">
        {children}
      </Card>
    </section>
  );
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = copyFor(locale);
  const region = getRegion();

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

      <CharacterSearch locale={locale} region={region} />

      <RecentSearches locale={locale} region={region} />

      <PendingSection
        title={copy.home.meta.title}
        scope={`${BRACKET_LABELS["solo-shuffle"]} · ${region.toUpperCase()}`}
      >
        {copy.home.meta.empty}
      </PendingSection>

      <PendingSection title={copy.home.population.title}>
        {copy.home.population.empty}
      </PendingSection>

      <p className="text-subtle-foreground max-w-measure text-xs">{copy.home.lead}</p>
    </main>
  );
}
