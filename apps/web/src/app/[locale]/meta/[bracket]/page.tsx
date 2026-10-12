import { resolveMetaRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { MetaPage, metaMetadata } from "../../../../components/meta-page";
import { isLocale, localizedPathname } from "../../../../i18n/locales";
import { loadMetaData } from "../../../../server/meta";
import { isPublishedBracket } from "../../../../server/published";

interface MetaParams {
  locale: string;
  bracket: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<MetaParams>;
}): Promise<Metadata> {
  const { locale, bracket } = await params;
  const resolution = resolveMetaRoute({ bracket });
  if (!isLocale(locale) || resolution.status !== "canonical") return {};
  if (!isPublishedBracket(resolution.route.bracket)) return {};

  return metaMetadata(resolution.route.bracket, locale);
}

export default async function MetaBracketPage({ params }: { params: Promise<MetaParams> }) {
  const { locale, bracket } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveMetaRoute({ bracket });
  if (resolution.status === "unknown") notFound();
  // El catálogo sabe construir /meta/3v3; con su interruptor apagado no hay
  // datos detrás, y una página vacía que se puede indexar es peor que un 404.
  if (resolution.status === "canonical" && !isPublishedBracket(resolution.route.bracket)) {
    notFound();
  }
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  const data = await loadMetaData(resolution.route.bracket);
  return <MetaPage locale={locale} data={data} />;
}
