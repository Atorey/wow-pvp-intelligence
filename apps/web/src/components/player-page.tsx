import { getCharacterLookupTtlMinutes } from "@wowpvp/blizzard";
import {
  BRACKET_LABELS,
  formatSegment,
  methodologyPath,
  parseShuffleBracket,
  playerPath,
  type PlayerRoute,
} from "@wowpvp/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatDate, formatPercentile, formatRating } from "../i18n/format";
import { type Locale, localizedPathname } from "../i18n/locales";
import { refreshPlayer } from "../server/actions";
import type { PlayerAbsence, PlayerProfile } from "../server/player";
import type { StandingView } from "../server/player-profile";
import type { RatingHistoryView } from "../server/rating-history-view";
import type { RefreshStatus } from "../server/refresh";
import { CountRow, CountedFigure, DeclaredAbsence } from "./counted-figure";
import { FigureCard } from "./figure-card";
import { GearList } from "./gear-list";
import { PlayerGapBox } from "./player-gap-box";
import { RatingHistory } from "./rating-history";
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
export type PlayerTab = "summary" | "gear" | "history";

export function isPlayerTab(value: string): value is PlayerTab {
  return value === "summary" || value === "gear" || value === "history";
}

export function PlayerPage({
  locale,
  route,
  profile,
  tab,
  history,
  refresh,
}: {
  locale: Locale;
  route: PlayerRoute;
  profile: PlayerProfile;
  tab: PlayerTab;
  /**
   * La serie de rating, cargada solo cuando la pestaña es la de histórico: el
   * resumen no la enseña y no tiene por qué pagar su viaje a Storage.
   */
  history: RatingHistoryView | null;
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
    const target = params.tab ?? tab;
    if (target !== "summary") query.set("tab", target);
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
       * su propia dirección. Talentos no está porque todavía no tiene nada que
       * enseñar: hay nodos agregados por segmento pero no comparación, y una
       * pestaña vacía es un "coming soon".
       */}
      <nav aria-label={copy.tabs.label} className="border-border flex gap-1 border-b">
        <Tab href={href({ tab: "summary" })} current={tab === "summary"} accent={color.border}>
          {copy.tabs.summary}
        </Tab>
        <Tab href={href({ tab: "gear" })} current={tab === "gear"} accent={color.border}>
          {copy.tabs.gear}
        </Tab>
        <Tab href={href({ tab: "history" })} current={tab === "history"} accent={color.border}>
          {copy.tabs.history}
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
              measured={{ spec: active.slug, bracket: "solo-shuffle" }}
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
              {/* Al apartado de confianza, que es lo que esta columna acaba de
                  declarar: quien llega aquí viene de leer un "n" y un nivel. */}
              <Link
                href={localizedPathname(methodologyPath("confidence"), locale)}
                className="text-primary underline"
              >
                {copy.methodology}
              </Link>
            </p>
          </aside>
        </div>
      ) : tab === "gear" ? (
        <GearList
          locale={locale}
          items={profile.gear?.items ?? []}
          observedAt={profile.gear?.provenance.observedAt ?? snapshot.provenance.observedAt}
        />
      ) : (
        history && (
          <RatingHistory
            locale={locale}
            spec={active.spec.label}
            color={color.text}
            history={history}
          />
        )
      )}
    </main>
  );
}

/**
 * Un personaje del que no consta ninguna observación, en sus dos formas: el que
 * no está en la población y el que está y no le consta rating.
 *
 * Sigue sin preguntarle nada a Blizzard al pintarse —esto es un `GET`, y una
 * llamada colgada de un `GET` la dispara cualquier precarga (ADR 0024)—, pero su
 * acción sí pregunta, porque es un `POST`. Un `<Link>` al buscador no podía:
 * `/search` resuelve contra la población antes de tocar la API, así que para un
 * personaje que ya está en `characters` la rama que llama a Blizzard es
 * inalcanzable y el perfil se quedaba en un callejón sin salida que no caducaba.
 * El camino que escribe es el mismo "Actualizar" del perfil.
 */
export function PlayerNotObserved({
  locale,
  route,
  absence,
  refresh,
}: {
  locale: Locale;
  route: PlayerRoute;
  absence: PlayerAbsence;
  /** Resultado de la última pulsación del botón, si viene en la URL. */
  refresh: RefreshStatus | null;
}) {
  const player = copyFor(locale).player;
  const copy = player.absent;
  const closed = absence.state === "no-rating" ? absence.closedSeason : null;
  const message =
    absence.state === "unknown"
      ? copy.unknown
      : closed
        ? { title: copy.closedSeason.title(closed.seasonId), body: copy.closedSeason.body }
        : copy.noRating;

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-10">
      {/*
       * La grafía de Blizzard cuando la tenemos y el slug cuando no: de un
       * personaje que no está en la población no sabemos cómo escribe su nombre,
       * y lo único nuestro es el de la URL (ADR 0017).
       */}
      <h1 className="text-foreground text-2xl">
        {absence.state === "no-rating" ? absence.nameDisplay : route.nameSlug}
      </h1>
      <p className="text-muted-foreground text-sm">
        {route.realmSlug} · {route.region.toUpperCase()}
      </p>
      <Card className="gap-3 p-5">
        <h2 className="text-foreground text-lg">{message.title}</h2>
        <p className="text-muted-foreground text-base">{message.body}</p>
        {/*
         * Lo único que queda de una temporada cerrada (ADR 0042): por spec, el
         * último rating y el máximo, sin fecha de la temporada vigente al lado
         * porque no la hay.
         */}
        {closed && (
          <ul className="flex flex-col gap-1">
            {closed.standings.map((standing) => (
              <li key={standing.bracket} className="text-sm">
                <span className="text-foreground">
                  {parseShuffleBracket(standing.bracket)?.label ?? standing.bracket}
                </span>
                <span className="text-muted-foreground">
                  {" · "}
                  {copy.closedSeason.standing(
                    formatRating(standing.last.rating, locale),
                    formatRating(standing.peak, locale),
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
        {/*
         * El alcance del sitio, con la misma frase que el perfil usa en "otras
         * modalidades" y no una variante suya: es la explicación de por qué a
         * alguien con clasificación en 2v2 no le consta rating aquí, y dos
         * redacciones de un mismo límite acabarían diciendo cosas distintas.
         */}
        {absence.state === "no-rating" && (
          <p className="text-subtle-foreground text-sm">{player.brackets.none}</p>
        )}
        {/*
         * Cuándo se le preguntó, que es lo que convierte "no le consta rating" en
         * una afirmación fechada. Sin fila en la bitácora no se escribe nada: su
         * identidad pudo entrar por el leaderboard, que no deja ninguna.
         */}
        {absence.state === "no-rating" && absence.askedAt !== null && (
          <p className="text-subtle-foreground text-sm">
            {copy.noRating.asked(formatDate(absence.askedAt, locale))}
          </p>
        )}
        {refresh !== null && <AbsenceNotice locale={locale} status={refresh} />}
        <RefreshForm locale={locale} route={route} label={copy.action} />
      </Card>
    </main>
  );
}

/**
 * Qué pasó al pulsar el botón de esta pantalla.
 *
 * No reusa `RefreshNotice` por sus dos extremos. `updated` allí no dice nada —la
 * ficha refrescada se ve sola— y aquí es el aviso que más falta hace: si después
 * de preguntar seguimos en esta pantalla, es que Blizzard contestó y no traía
 * rating. Y los avisos de "no se pudo preguntar" del perfil remontan con "lo de
 * abajo es la última observación registrada", que aquí sería falso: abajo no hay
 * ninguna.
 */
function AbsenceNotice({ locale, status }: { locale: Locale; status: RefreshStatus }) {
  const copy = copyFor(locale);
  const absent = copy.player.absent;

  const text =
    status === "updated"
      ? absent.stillNoRating
      : status === "cached"
        ? // El mismo TTL que decidió no llamar (§28). Un personaje sin rating lo
          // tiene igual: su frescura se mide sobre la bitácora, que es lo único
          // que esa respuesta deja.
          copy.player.refresh.fresh(String(getCharacterLookupTtlMinutes()))
        : status === "unavailable"
          ? absent.unavailable
          : status === "rate-limited"
            ? absent.rateLimited
            : // "No existe" de alguien que sí teníamos: un borrado, un rename o
              // un transfer entre aquella búsqueda y esta.
              copy.search.notFound.body;

  return <p className="text-muted-foreground text-sm">{text}</p>;
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
      <FigureCard
        value={formatRating(snapshot.rating, locale)}
        label={copy.rating}
        note={
          profile.peakRating !== null && profile.peakRating > snapshot.rating
            ? copy.peak(formatRating(profile.peakRating, locale))
            : undefined
        }
      />
      <FigureCard
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
      <FigureCard
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
        <FigureCard
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
      {/*
        La limitación de origen va siempre, no solo cuando hay percentil: la
        fracción se apoya en la misma población recortada y arrastra el mismo
        techo (§14 del plan).
      */}
      <p className="text-subtle-foreground text-sm">{copy.ladderCap}</p>
    </SectionCard>
  );
}

/**
 * El `POST` que vuelve a preguntarle a Blizzard, con la identidad en campos
 * ocultos.
 *
 * `spec` y `tab` son opcionales porque la pantalla de personaje sin
 * observaciones no tiene ninguna de las dos: no hay spec observada que elegir ni
 * pestaña que conservar. La acción ya sabe prescindir de ellas, y sin ellas la
 * vuelta es el perfil limpio.
 */
function RefreshForm({
  locale,
  route,
  spec,
  tab,
  label,
}: {
  locale: Locale;
  route: PlayerRoute;
  spec?: string;
  tab?: PlayerTab;
  label: string;
}) {
  return (
    <form action={refreshPlayer}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="region" value={route.region} />
      <input type="hidden" name="realm" value={route.realmSlug} />
      <input type="hidden" name="name" value={route.nameSlug} />
      {spec !== undefined && <input type="hidden" name="spec" value={spec} />}
      {tab !== undefined && <input type="hidden" name="tab" value={tab} />}
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
        : status === "rate-limited"
          ? ttl.rateLimited
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
