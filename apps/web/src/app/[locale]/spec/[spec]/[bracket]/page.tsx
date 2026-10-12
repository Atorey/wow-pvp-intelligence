import { resolveSpecRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { SpecPage, specMetadata } from "../../../../../components/spec-page";
import { isLocale, localizedPathname } from "../../../../../i18n/locales";
import { isRouteBracketPublished } from "../../../../../server/published";
import { loadSpecOverview } from "../../../../../server/spec";

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
  if (!isRouteBracketPublished(resolution.route)) return {};

  return specMetadata(resolution.route, locale);
}

export default async function SpecBracketPage({ params }: { params: Promise<SpecBracketParams> }) {
  const { locale, ...rest } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolveSpecRoute(rest);
  if (resolution.status === "unknown") notFound();
  // El catálogo sabe construir la ruta de 3v3; si su interruptor está apagado no
  // hay datos detrás, y una página vacía que se puede indexar es peor que un 404.
  if (resolution.status === "canonical" && !isRouteBracketPublished(resolution.route)) {
    notFound();
  }
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  const data = await loadSpecOverview(resolution.route);
  return <SpecPage route={resolution.route} locale={locale} data={data} />;
}
