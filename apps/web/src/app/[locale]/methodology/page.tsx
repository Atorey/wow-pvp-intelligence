import { METHODOLOGY_PATH } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PagePlaceholder } from "../../../components/page-placeholder";
import { alternatesFor } from "../../../i18n/alternates";
import { copyFor } from "../../../i18n/copy";
import { LOCALES, isLocale } from "../../../i18n/locales";

// La única página del MVP sin tramos dinámicos, y obligatoria desde el día 1
// (§24): es la que sostiene la promesa de método. Existe en las dos lenguas y
// se genera en build, porque su contenido no depende de ningún dato.
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const copy = copyFor(locale).methodology;
  return {
    title: copy.title,
    description: copy.lead,
    alternates: alternatesFor(METHODOLOGY_PATH, locale),
  };
}

export default async function MethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const copy = copyFor(locale).methodology;
  return <PagePlaceholder locale={locale} title={copy.title} lead={copy.lead} />;
}
