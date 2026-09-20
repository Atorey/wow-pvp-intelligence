import { resolveMetaRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { MetaPage, metaMetadata } from "../../../../components/meta-page";
import { isLocale, localizedPathname } from "../../../../i18n/locales";
import { loadMetaData } from "../../../../server/meta";

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

  return metaMetadata(resolution.route.bracket, locale);
}

export default async function MetaBracketPage({ params }: { params: Promise<MetaParams> }) {
  const { locale, bracket } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveMetaRoute({ bracket });
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  const data = await loadMetaData(resolution.route.bracket);
  return <MetaPage locale={locale} data={data} />;
}
