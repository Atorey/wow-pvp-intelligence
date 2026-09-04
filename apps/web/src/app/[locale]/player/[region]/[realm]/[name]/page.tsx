import { playerPath, resolvePlayerRoute } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound, permanentRedirect } from "next/navigation";

import {
  PlayerNotObserved,
  PlayerPage,
  isPlayerTab,
} from "../../../../../../components/player-page";
import { alternatesFor } from "../../../../../../i18n/alternates";
import { copyFor } from "../../../../../../i18n/copy";
import { isLocale, localizedPathname } from "../../../../../../i18n/locales";
import { loadPlayerProfile } from "../../../../../../server/player";
import { isRefreshStatus } from "../../../../../../server/refresh";

interface PlayerParams {
  locale: string;
  region: string;
  realm: string;
  name: string;
}

/**
 * Lo que puede venir en la query. Ninguno es parte de la identidad del recurso:
 * la URL canónica del personaje es la ruta a secas (ADR 0020, decisión 7), y
 * estos tres solo eligen qué se enseña de él.
 */
interface PlayerQuery {
  spec?: string;
  tab?: string;
  refresh?: string;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
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
    // La canónica no lleva la query: `?spec=` y `?tab=` son vistas del mismo
    // personaje, y anunciarlas como URL propias multiplicaría por cuatro las
    // direcciones indexables de cada perfil sin una sola página nueva.
    alternates: alternatesFor(playerPath(route), locale),
  };
}

export default async function PlayerRoutePage({
  params,
  searchParams,
}: {
  params: Promise<PlayerParams>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
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
  const query = (await searchParams) as PlayerQuery;
  const spec = first(query.spec);

  const profile = await loadPlayerProfile(route, spec);
  // Sin observaciones no hay perfil que pintar, y tampoco se le pregunta a
  // Blizzard desde aquí: esto es un `GET` (ADR 0024, decisión 2).
  if (!profile) return <PlayerNotObserved locale={locale} route={route} />;

  const tab = first(query.tab);
  const refresh = first(query.refresh);

  return (
    <PlayerPage
      locale={locale}
      route={route}
      profile={profile}
      tab={tab && isPlayerTab(tab) ? tab : "summary"}
      refresh={refresh && isRefreshStatus(refresh) ? refresh : null}
    />
  );
}
