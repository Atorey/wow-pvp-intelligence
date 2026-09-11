import { resolveSpecRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { SegmentPage } from "../../../../../../components/segment-page";
import { specMetadata } from "../../../../../../components/spec-page";
import { isLocale, localizedPathname } from "../../../../../../i18n/locales";
import { loadSegmentPage } from "../../../../../../server/spec";

interface SpecSegmentParams {
  locale: string;
  spec: string;
  bracket: string;
  segment: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<SpecSegmentParams>;
}): Promise<Metadata> {
  const { locale, ...rest } = await params;
  const resolution = resolveSpecRoute(rest);
  if (!isLocale(locale) || resolution.status !== "canonical") return {};

  return specMetadata(resolution.route, locale);
}

// La página de segmento es la que §22 marca como prioritaria para indexar, y la
// que la regla anti-thin-content condiciona a su muestra: se indexa si alguna de
// sus tres bases llega al umbral (ADR 0029). La ruta existe aunque no llegue,
// porque de ella cuelga el enlazado entre tramos y porque explica qué le falta.
export default async function SpecSegmentPage({ params }: { params: Promise<SpecSegmentParams> }) {
  const { locale, ...rest } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveSpecRoute(rest);
  if (resolution.status === "unknown") notFound();
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  const data = await loadSegmentPage(resolution.route);
  return <SegmentPage route={resolution.route} locale={locale} data={data} />;
}
