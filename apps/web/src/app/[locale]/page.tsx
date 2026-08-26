import { HOME_PATH } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

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

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = copyFor(locale);

  // La búsqueda de personaje, que es lo que la §23 del plan pone en el centro de
  // la portada, entra con su propio trabajo. Aquí no va un campo de texto que no
  // busca nada.
  return (
    <main className="mx-auto flex max-w-measure flex-col justify-center gap-4 px-5 py-16">
      <h1 className="text-2xl tracking-caps text-accent uppercase">{copy.site.name}</h1>
      <p className="text-lg text-ink">{copy.site.tagline}</p>
      <p className="text-sm text-ink-secondary">{copy.home.status}</p>
    </main>
  );
}
