import { resolveSpecRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { SpecPage, specMetadata } from "../../../../components/spec-page";
import { isLocale, localizedPathname } from "../../../../i18n/locales";

interface SpecParams {
  locale: string;
  spec: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SpecParams>;
}): Promise<Metadata> {
  const { locale, spec } = await params;
  const resolution = resolveSpecRoute({ spec });
  if (!isLocale(locale) || resolution.status !== "canonical") return {};

  return specMetadata(resolution.route, locale);
}

export default async function SpecOverviewPage({ params }: { params: Promise<SpecParams> }) {
  const { locale, spec } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveSpecRoute({ spec });
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  return <SpecPage route={resolution.route} locale={locale} />;
}
