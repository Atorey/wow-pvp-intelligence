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

  // El andamiaje se maqueta con el sistema visual, no a pelo: si los tokens no
  // se usan en ningún sitio, nadie se entera de que están mal hasta #17.
  return (
    <main className="mx-auto flex min-h-dvh max-w-measure flex-col justify-center gap-4 px-5 py-8">
      <h1 className="text-2xl tracking-caps text-accent uppercase">One Rung</h1>
      <p className="text-lg text-ink">{copy.tagline}</p>
      <p className="text-sm text-ink-secondary">{copy.status}</p>
      <Link
        href={`/${other}`}
        hrefLang={other}
        className="text-accent self-start text-sm underline"
      >
        {COPY[other].switchTo}
      </Link>
    </main>
  );
}
