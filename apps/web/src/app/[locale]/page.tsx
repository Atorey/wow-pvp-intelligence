import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { alternatesFor } from "../../i18n/alternates";
import { LOCALES, isLocale, type Locale } from "../../i18n/locales";

// Marcador de posición mientras no hay páginas de verdad. El copy definitivo y
// dónde vive —diccionarios, librería de i18n, qué se traduce— es de #25; aquí
// solo hay lo justo para comprobar que las dos lenguas se sirven.
const COPY: Record<Locale, { tagline: string; status: string; switchTo: string }> = {
  en: {
    tagline: "See what separates you from the next rung.",
    status: "The site is being built. There's nothing to look up yet.",
    switchTo: "Español",
  },
  es: {
    tagline: "Mira qué te separa del siguiente escalón.",
    status: "El sitio está en construcción. Todavía no hay nada que consultar.",
    switchTo: "English",
  },
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  return { alternates: alternatesFor("/", locale) };
}

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = COPY[locale];
  const other = LOCALES.find((candidate) => candidate !== locale) ?? locale;

  return (
    <main>
      <h1>One Rung</h1>
      <p>{copy.tagline}</p>
      <p>{copy.status}</p>
      <Link href={`/${other}`} hrefLang={other}>
        {COPY[other].switchTo}
      </Link>
    </main>
  );
}
