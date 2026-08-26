import { resolveSpecRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { SpecPage, specMetadata } from "../../../../../components/spec-page";
import { isLocale, localizedPathname } from "../../../../../i18n/locales";

interface SpecBracketParams {
  locale: string;
  spec: string;
  bracket: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SpecBracketParams>;
}): Promise<Metadata> {
  const { locale, ...rest } = await params;
  const resolution = resolveSpecRoute(rest);
  if (!isLocale(locale) || resolution.status !== "canonical") return {};

  return specMetadata(resolution.route, locale);
}

export default async function SpecBracketPage({ params }: { params: Promise<SpecBracketParams> }) {
  const { locale, ...rest } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveSpecRoute(rest);
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  return <SpecPage route={resolution.route} locale={locale} />;
}
