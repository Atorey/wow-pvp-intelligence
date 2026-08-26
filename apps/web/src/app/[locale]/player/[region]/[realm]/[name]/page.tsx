import { playerPath, resolvePlayerRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import { PagePlaceholder } from "../../../../../../components/page-placeholder";
import { alternatesFor } from "../../../../../../i18n/alternates";
import { copyFor } from "../../../../../../i18n/copy";
import { isLocale, localizedPathname } from "../../../../../../i18n/locales";

interface PlayerParams {
  locale: string;
  region: string;
  realm: string;
  name: string;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<PlayerParams>;
}): Promise<Metadata> {
  const { locale, ...rest } = await params;
  const resolution = resolvePlayerRoute(rest);
  if (!isLocale(locale) || resolution.status !== "canonical") return {};

  const { route } = resolution;
  return {
    title: `${route.nameSlug} · ${route.realmSlug}`,
    description: copyFor(locale).player.lead,
    alternates: alternatesFor(playerPath(route), locale),
  };
}

export default async function PlayerPage({ params }: { params: Promise<PlayerParams> }) {
  const { locale, ...rest } = await params;
  if (!isLocale(locale)) notFound();

  const resolution = resolvePlayerRoute(rest);
  if (resolution.status === "unknown") notFound();
  // Permanente y no temporal: la forma canónica de un personaje no cambia
  // (ADR 0017), así que el buscador puede consolidar las dos URL en una. Es lo
  // contrario que la raíz sin prefijo, que negocia idioma y por eso va con 302.
  if (resolution.status === "redirect") {
    permanentRedirect(localizedPathname(resolution.path, locale));
  }

  const { route } = resolution;
  const copy = copyFor(locale);

  return (
    <PagePlaceholder locale={locale} title={route.nameSlug} lead={copy.player.lead}>
      {/*
       * Reino y región son los otros dos tercios de la identidad, no un
       * adorno: sin ellos el nombre no señala a nadie en concreto.
       */}
      <p className="text-ink-secondary text-sm">
        {route.realmSlug} · {route.region.toUpperCase()}
      </p>
    </PagePlaceholder>
  );
}
