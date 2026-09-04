import { getCharacterLookupTtlMinutes } from "@wowpvp/blizzard";
import {
  BRACKET_LABELS,
  METHODOLOGY_PATH,
  formatSegment,
  playerPath,
  searchPath,
  type PlayerRoute,
} from "@wowpvp/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatDate, formatPercentile, formatRating } from "../i18n/format";
import { type Locale, localizedPathname } from "../i18n/locales";
import { refreshPlayer } from "../server/actions";
import type { PlayerProfile } from "../server/player";
import type { StandingView } from "../server/player-profile";
import type { RefreshStatus } from "../server/refresh";
import { CountRow, CountedFigure, DeclaredAbsence } from "./counted-figure";
import { GearList } from "./gear-list";
import { PlayerGapBox } from "./player-gap-box";
import { SectionCard } from "./section-card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { Card } from "./ui/card";
import { Separator } from "./ui/separator";

/**
 * La página de perfil (#17), con los bloques en el orden que fija la §2.3 del
 * brief.
 *
 * Ese orden tiene un punto no negociable: **el bloque descriptivo va después de
 * la caja Player Gap, nunca antes**. Si la primera cifra grande de la página
 * fuera un percentil, la página prometería percentiles y la caja vacía se
 * leería como un fallo. Al revés, la caja declara lo que no hay y lo de debajo
 * se lee como lo que es: lo que sí se puede decir mientras tanto.
 */
export type PlayerTab = "summary" | "gear";

export function isPlayerTab(value: string): value is PlayerTab {
  return value === "summary" || value === "gear";
}

export function PlayerPage({
  locale,
  route,
  profile,
  tab,
  refresh,
}: {
  locale: Locale;
  route: PlayerRoute;
  profile: PlayerProfile;
  tab: PlayerTab;
  /** Resultado de la última pulsación de "Actualizar", si viene en la URL. */
  refresh: RefreshStatus | null;
}) {
  const copy = copyFor(locale).player;
  const { snapshot, active, gap, standing } = profile;
  const color = classColor(snapshot.classSlug);
  const bracketLabel = BRACKET_LABELS["solo-shuffle"];

  /**
   * Las dos vistas y las specs viven en la query y no en tramos de ruta: el
   * mapa del ADR 0020 tiene una sola URL por recurso, y el recurso es el
   * personaje. La canónica que se anuncia sigue siendo la ruta sin query.
   */
  const href = (params: { spec?: string; tab?: PlayerTab }): string => {
    const query = new URLSearchParams();
    const spec = params.spec ?? active.slug;
    // Solo se escribe lo que no es el defecto: así el enlace de la spec
    // principal y el de la pestaña de resumen son la ruta limpia.
    if (spec !== profile.specs[0]?.slug) query.set("spec", spec);
    if ((params.tab ?? tab) === "gear") query.set("tab", "gear");
    const path = localizedPathname(playerPath(route), locale);
    return query.size > 0 ? `${path}?${query.toString()}` : path;
  };

  return (
    <main className="mx-auto flex max-w-page flex-col gap-8 px-5 py-8 lg:px-8">
      <header className="flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 flex-col gap-2">
            <h1 className={`text-2xl ${color.text}`}>{snapshot.nameDisplay}</h1>
            <div className="flex flex-wrap items-center gap-2">
              {/* El borde en el color de la clase acompaña; la spec está escrita. */}
              <Badge variant="outline" className={color.border}>
                {active.spec.label}
              </Badge>
              <Badge variant="outline">{`${snapshot.realmSlug} · ${route.region.toUpperCase()}`}</Badge>
              <Badge variant="outline">{bracketLabel}</Badge>
              <Badge variant="outline">{copy.season(formatRating(profile.seasonId, locale))}</Badge>
            </div>
          </div>
          <RefreshForm
            locale={locale}
            route={route}
            spec={active.slug}
            tab={tab}
            label={copy.refresh.action}
          />
        </div>

        <p className="text-subtle-foreground text-sm">
          {copy.observedAt(formatDate(snapshot.provenance.observedAt, locale))}
        </p>
        {refresh !== null && <RefreshNotice locale={locale} status={refresh} />}
      </header>

      <Figures locale={locale} profile={profile} />

      {profile.specs.length > 1 && (
        <nav aria-label={copy.specs.label} className="flex flex-wrap items-center gap-2">
          {profile.specs.map((spec) => (
            <Badge
              key={spec.slug}
              asChild
              variant={spec.slug === active.slug ? "secondary" : "outline"}
              className="px-3 py-1"
            >
              <Link
                href={href({ spec: spec.slug })}
                aria-current={spec.slug === active.slug ? "page" : undefined}
              >
                {spec.spec.label} · {formatRating(spec.rating, locale)}
              </Link>
            </Badge>
          ))}
        </nav>
      )}

      {/*
       * Las pestañas son enlaces y no un componente con estado: se sirven ya
       * decididas desde el servidor, funcionan sin JavaScript y cada vista tiene
       * su propia dirección. Talentos e Histórico no están porque no hay dato
       * que enseñar (#24, #28) y una pestaña vacía es un "coming soon".
       */}
      <nav aria-label={copy.tabs.label} className="border-border flex gap-1 border-b">
        <Tab href={href({ tab: "summary" })} current={tab === "summary"} accent={color.border}>
          {copy.tabs.summary}
        </Tab>
        <Tab href={href({ tab: "gear" })} current={tab === "gear"} accent={color.border}>
          {copy.tabs.gear}
        </Tab>
      </nav>

      {tab === "summary" ? (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
          <div className="flex min-w-0 flex-col gap-6">
            <PlayerGapBox
              locale={locale}
              gap={gap}
              subject={{
                spec: active.spec.label,
                bracket: bracketLabel,
                rating: snapshot.rating,
              }}
            />
          </div>
          {/*
           * El bloque descriptivo y sus vecinos van en la columna de al lado,
           * pero **debajo** de la caja en pantalla estrecha: el orden del
           * documento es el de la §2.3 y la rejilla no lo reordena. Si el
           * percentil se leyera antes que la caja, la página prometería
           * percentiles.
           */}
          <aside className="flex flex-col gap-6">
            <Standing
              locale={locale}
              spec={active.spec.label}
              standing={standing}
              rating={snapshot.rating}
            />
            <SectionCard title={copy.brackets.title}>
              <p className="text-muted-foreground text-sm">{copy.brackets.none}</p>
            </SectionCard>
            {gap.state === "insufficient" && (
              <SectionCard title={copy.missing.title}>
                <div className="flex flex-col gap-4">
                  {/*
                    La primera línea dice la misma causa que la caja, y las dos
                    siguientes solo aparecen cuando lo que falta es del segmento.
                    Con el objetivo vacío, "0 de 0 perfiles cargados" señalaría
                    nuestro muestreo cuando todavía no hay a quién mirar; y con
                    el segmento muestreado de sobra, decir que le falta gear
                    sería señalar el lado que no falla.
                  */}
                  {gap.cause === "subject" && (
                    <DeclaredAbsence
                      label={copy.missing.subject.label}
                      body={copy.missing.subject.body}
                    />
                  )}
                  {gap.cause === "sampling" && (
                    <DeclaredAbsence
                      label={copy.missing.gear.label(formatSegment(gap.targetSegment))}
                      body={copy.missing.gear.body(
                        formatCount(gap.gearSample, locale),
                        formatCount(gap.population, locale),
                      )}
                    />
                  )}
                  {gap.cause === "population" && (
                    <DeclaredAbsence
                      label={copy.missing.population.label(formatSegment(gap.targetSegment))}
                      body={copy.missing.population.body(
                        formatCount(gap.population, locale),
                        formatCount(gap.needed, locale),
                      )}
                    />
                  )}
                  {gap.cause !== "subject" && (
                    <DeclaredAbsence
                      label={copy.missing.itemLevel.label(formatSegment(gap.targetSegment))}
                      body={copy.missing.itemLevel.body}
                    />
                  )}
                  <DeclaredAbsence
                    label={copy.missing.talents.label}
                    body={copy.missing.talents.body}
                  />
                  <DeclaredAbsence
                    label={copy.missing.stats.label}
                    body={copy.missing.stats.body}
                  />
                </div>
              </SectionCard>
            )}
            <p className="text-sm">
              <Link
                href={localizedPathname(METHODOLOGY_PATH, locale)}
                className="text-primary underline"
              >
                {copy.methodology}
              </Link>
            </p>
          </aside>
        </div>
      ) : (
        <GearList
          locale={locale}
          items={profile.gear?.items ?? []}
          observedAt={profile.gear?.provenance.observedAt ?? snapshot.provenance.observedAt}
        />
      )}
    </main>
  );
}

/**
 * Un personaje del que no consta ninguna observación.
 *
 * No es un 404 y no se le pregunta a Blizzard desde aquí: esto es un `GET` y
 * una llamada colgada de un `GET` la dispara cualquier precarga (ADR 0024). Lo
 * que se ofrece es el camino que sí escribe, que es el buscador.
 */
export function PlayerNotObserved({ locale, route }: { locale: Locale; route: PlayerRoute }) {
  const copy = copyFor(locale).player;

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-10">
      <h1 className="text-foreground text-2xl">{route.nameSlug}</h1>
      <p className="text-muted-foreground text-sm">
        {route.realmSlug} · {route.region.toUpperCase()}
      </p>
      <Card className="gap-3 p-5">
        <h2 className="text-foreground text-lg">{copy.unknown.title}</h2>
        <p className="text-muted-foreground text-base">{copy.unknown.body}</p>
        <p className="text-sm">
          <Link
            href={localizedPathname(
              searchPath({ realm: route.realmSlug, name: route.nameSlug }),
              locale,
            )}
            className="text-primary underline"
          >
            {copy.unknown.action}
          </Link>
        </p>
      </Card>
    </main>
  );
}

/**
 * Las cifras del propio jugador: lo único de la página que no depende del
 * perfil de nadie más (§2.3, bloque 1).
 *
 * Un dato ausente se escribe con un guion y no con un cero: `matches_played` a
 * null es "el endpoint no lo trae", no "no ha jugado ninguna" (regla 5).
 */
function Figures({ locale, profile }: { locale: Locale; profile: PlayerProfile }) {
  const copy = copyFor(locale).player.figures;
  const { snapshot, gap, standing } = profile;
  const percentile = standing.counts.percentile;
  /**
   * La mediana del objetivo solo acompaña al item level cuando hay comparación
   * que sostenerla. Es la misma cifra que enseña la caja, con el mismo
   * denominador: dos sitios de la página no pueden decir dos números distintos
   * del mismo segmento.
   */
  const target =
    gap.state === "comparable" && gap.itemLevel
      ? { segment: formatSegment(gap.targetSegment), median: gap.itemLevel.median }
      : null;

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Figure
        value={formatRating(snapshot.rating, locale)}
        label={copy.rating}
        note={
          profile.peakRating !== null && profile.peakRating > snapshot.rating
            ? copy.peak(formatRating(profile.peakRating, locale))
            : undefined
        }
      />
      <Figure
        value={snapshot.matchesPlayed === null ? "—" : formatCount(snapshot.matchesPlayed, locale)}
        label={copy.matches}
        note={
          snapshot.matchesWon !== null && snapshot.matchesLost !== null
            ? copy.record(
                formatCount(snapshot.matchesWon, locale),
                formatCount(snapshot.matchesLost, locale),
              )
            : undefined
        }
      />
      <Figure
        value={
          profile.equippedItemLevel === null ? "—" : formatRating(profile.equippedItemLevel, locale)
        }
        label={copy.itemLevel}
        note={
          target
            ? copy.itemLevelMedian(target.segment, formatRating(target.median, locale))
            : undefined
        }
      />
      {/*
       * El percentil solo existe por encima de MIN_SAMPLE_MEDIUM observados
       * (punto 4 del ADR 0011). Por debajo la tarjeta no se pinta con un guion:
       * la fracción sigue estando entera en el bloque descriptivo, que es donde
       * dice algo.
       */}
      {percentile !== null && (
        <Figure
          value={formatPercentile(percentile, locale)}
          label={copy.percentile}
          note={copy.below(
            formatCount(standing.counts.below, locale),
            formatCount(standing.counts.observed, locale),
          )}
        />
      )}
    </div>
  );
}

function Figure({
  value,
  label,
  note,
}: {
  value: string;
  label: string;
  /**
   * `| undefined` explícito y no solo `?`: con `exactOptionalPropertyTypes`, una
   * prop opcional no admite que le pasen `undefined` a propósito, que es justo
   * lo que hace el llamante cuando esa nota no existe.
   */
  note?: string | undefined;
}) {
  return (
    <Card className="gap-0.5 p-4">
      <span className="text-foreground font-display text-2xl">{value}</span>
      <span className="text-subtle-foreground text-sm">{label}</span>
      {note !== undefined && <span className="text-muted-foreground pt-1 text-sm">{note}</span>}
    </Card>
  );
}

/**
 * El bloque descriptivo (§2.3, bloque 3).
 *
 * Las dos poblaciones que junta no son la misma —el percentil cuenta la
 * temporada entera y los segmentos solo a quien estuvo activo en la ventana—,
 * así que la ventana se declara debajo. Sin decirlo, las cifras se leerían como
 * partes del mismo total y no suman.
 */
function Standing({
  locale,
  spec,
  standing,
  rating,
}: {
  locale: Locale;
  spec: string;
  standing: StandingView;
  rating: number;
}) {
  const copy = copyFor(locale).player.standing;
  const counts = standing.counts;

  return (
    <SectionCard title={copy.title}>
      <CountedFigure
        fraction={copy.sentence(
          formatCount(counts.below, locale),
          formatCount(counts.observed, locale),
          spec,
          formatRating(rating, locale),
        )}
        {...(counts.percentile !== null
          ? { derived: copy.percentile(formatPercentile(counts.percentile, locale)) }
          : {})}
      />
      {(standing.ownPopulation !== null ||
        standing.targetPopulation !== null ||
        counts.highest !== null) && (
        <>
          <Separator />
          <div className="flex flex-col gap-2">
            {standing.ownPopulation !== null && (
              <CountRow
                label={copy.segment(formatSegment(standing.ownSegment))}
                value={formatCount(standing.ownPopulation, locale)}
              />
            )}
            {standing.targetSegment && standing.targetPopulation !== null && (
              <CountRow
                label={copy.segment(formatSegment(standing.targetSegment))}
                value={formatCount(standing.targetPopulation, locale)}
              />
            )}
            {/*
              El máximo sale del mismo recuento que el percentil y no de los
              segmentos: los segmentos cuentan con ventana de actividad, y su
              máximo puede quedar por debajo del rating del propio jugador que
              se está mirando.
            */}
            {counts.highest !== null && (
              <CountRow label={copy.highest} value={formatRating(counts.highest, locale)} />
            )}
          </div>
          {standing.activityWindowDays !== null && (
            <p className="text-subtle-foreground text-sm">
              {copy.segmentsNote(formatCount(standing.activityWindowDays, locale))}
            </p>
          )}
        </>
      )}
      <p className="text-subtle-foreground text-sm">{copy.observedNote}</p>
    </SectionCard>
  );
}

function RefreshForm({
  locale,
  route,
  spec,
  tab,
  label,
}: {
  locale: Locale;
  route: PlayerRoute;
  spec: string;
  tab: PlayerTab;
  label: string;
}) {
  return (
    <form action={refreshPlayer}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="region" value={route.region} />
      <input type="hidden" name="realm" value={route.realmSlug} />
      <input type="hidden" name="name" value={route.nameSlug} />
      <input type="hidden" name="spec" value={spec} />
      <input type="hidden" name="tab" value={tab} />
      <Button type="submit" variant="outline">
        {label}
      </Button>
    </form>
  );
}

/** Qué pasó al pulsar "Actualizar". `cached` no es un fallo: es el TTL de §28. */
function RefreshNotice({ locale, status }: { locale: Locale; status: RefreshStatus }) {
  const copy = copyFor(locale);
  const ttl = copy.player.refresh;

  const text =
    status === "cached"
      ? // El mismo TTL que decidió no llamar, para que la frase no lo repita por
        // su cuenta y se quede desfasada el día que cambie la variable.
        ttl.fresh(String(getCharacterLookupTtlMinutes()))
      : status === "unavailable"
        ? ttl.unavailable
        : status === "not-found"
          ? copy.search.notFound.body
          : null;

  if (text === null) return null;
  return <p className="text-muted-foreground text-sm">{text}</p>;
}

function Tab({
  href,
  current,
  accent,
  children,
}: {
  href: string;
  current: boolean;
  accent: string;
  children: ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={current ? "page" : undefined}
      className={`font-display -mb-px border-b-2 px-4 py-2 text-base ${
        current ? `text-foreground ${accent}` : "text-muted-foreground border-transparent"
      }`}
    >
      {children}
    </Link>
  );
}
