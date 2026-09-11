import {
  BRACKET_LABELS,
  BRACKET_SLUGS,
  CLASS_LABELS,
  formatSegment,
  isClassSlug,
  methodologyPath,
  specPath,
  type SpecRoute,
} from "@wowpvp/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Fragment } from "react";

import { classColor } from "../design/class-color";
import { alternatesFor } from "../i18n/alternates";
import { copyFor } from "../i18n/copy";
import { formatCount, formatRating, formatShare } from "../i18n/format";
import { type Locale, localizedPathname } from "../i18n/locales";
import { robotsFor } from "../seo/indexable";
import { isSpecRouteIndexable, type SpecOverviewData, type SpecScope } from "../server/spec";
import type { SpecOverview } from "../server/spec-view";
import { FigureCard } from "./figure-card";
import { RunProvenance } from "./run-provenance";
import { SpecSegmentsTable } from "./spec-segments-table";
import { Badge } from "./ui/badge";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbSeparator,
} from "./ui/breadcrumb";
import { Card } from "./ui/card";

/**
 * Lo que comparten los tres niveles de `/spec/…`.
 *
 * Están juntos porque son la misma página con un filtro más, no tres pantallas
 * distintas: el título, la ruta canónica y las migas se derivan de hasta dónde
 * llega la URL. Escribirlo tres veces sería garantizar que el día que cambie el
 * formato del título cambie en dos de los tres sitios.
 */
function titleFor(route: SpecRoute): string {
  const parts = [route.spec.label];
  if (route.bracket) parts.push(BRACKET_LABELS[route.bracket]);
  if (route.segment) parts.push(formatSegment(route.segment));
  return parts.join(" · ");
}

function leadFor(route: SpecRoute, locale: Locale): string {
  const copy = copyFor(locale).spec;
  const spec = route.spec.label;

  if (route.bracket && route.segment) {
    return copy.inSegment(spec, BRACKET_LABELS[route.bracket], formatSegment(route.segment));
  }
  if (route.bracket) return copy.inBracket(spec, BRACKET_LABELS[route.bracket]);
  return copy.lead(spec);
}

/** Un nivel de la miga de pan. Sin `path` se escribe como texto. */
interface Crumb {
  label: string;
  path?: string;
}

/**
 * Los niveles de encima de la página, del más general al más concreto.
 *
 * Empiezan en la clase, como en el mockup, aunque la clase todavía no tenga
 * página: su ruta no está decidida (ADR 0020), y esos dos niveles se escriben
 * como texto. En la barra lateral la clase despliega sus specs; aquí no hay
 * dónde desplegarla, y un enlace a un 404 sería peor que un nivel que todavía no
 * lleva a ninguna parte.
 */
function trailFor(route: SpecRoute, locale: Locale): Crumb[] {
  const trail: Crumb[] = [{ label: copyFor(locale).nav.classesLabel }];
  if (isClassSlug(route.spec.classSlug)) {
    trail.push({ label: CLASS_LABELS[route.spec.classSlug] });
  }
  if (route.bracket) trail.push({ label: route.spec.label, path: specPath(route.spec) });
  if (route.bracket && route.segment) {
    trail.push({
      label: BRACKET_LABELS[route.bracket],
      path: specPath(route.spec, route.bracket),
    });
  }
  return trail;
}

export async function specMetadata(route: SpecRoute, locale: Locale): Promise<Metadata> {
  return {
    title: titleFor(route),
    description: leadFor(route, locale),
    alternates: alternatesFor(specPath(route.spec, route.bracket, route.segment), locale),
    // Cada ruta con su muestra, y con la misma lectura que decide el sitemap:
    // un tramo entra si alguna de sus tres bases llega al umbral, y la spec y la
    // modalidad si entra alguno de sus tramos (ADR 0029, decisiones 2 y 4).
    robots: robotsFor(await isSpecRouteIndexable(route), process.env),
  };
}

/**
 * La cabecera de los tres niveles: migas, titular, ámbito y, en el resumen, la
 * modalidad.
 *
 * El selector de modalidad lista las del catálogo y ninguna más. El mockup
 * dibuja las cinco, pero cuatro llevarían a una página que no existe: una opción
 * que no lleva a ninguna parte promete un dato que no hay (regla 6). El día que
 * entre una segunda modalidad aparece sola, porque sale de `BRACKET_SLUGS`.
 */
export function SpecHeader({
  route,
  locale,
  scope,
  showBrackets,
}: {
  route: SpecRoute;
  locale: Locale;
  scope: SpecScope;
  showBrackets: boolean;
}) {
  const copy = copyFor(locale);
  const color = classColor(route.spec.classSlug);

  return (
    <header className="flex flex-col gap-4">
      <Breadcrumb aria-label={copy.nav.trailLabel}>
        <BreadcrumbList>
          {trailFor(route, locale).map((crumb, index) => (
            <Fragment key={crumb.label}>
              {index > 0 && <BreadcrumbSeparator>/</BreadcrumbSeparator>}
              <BreadcrumbItem>
                {crumb.path === undefined ? (
                  crumb.label
                ) : (
                  <BreadcrumbLink asChild className="underline">
                    <Link href={localizedPathname(crumb.path, locale)}>{crumb.label}</Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          ))}
        </BreadcrumbList>
      </Breadcrumb>

      <div className="flex flex-col gap-2">
        {/* El color de la clase acompaña; la spec está escrita. */}
        <h1 className={`text-2xl ${color.text}`}>{titleFor(route)}</h1>
        <p className="text-muted-foreground max-w-measure text-base">{leadFor(route, locale)}</p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {scope.seasonId !== null && (
          <Badge variant="outline">
            {`${copy.spec.season(formatRating(scope.seasonId, locale))} · ${scope.region.toUpperCase()}`}
          </Badge>
        )}
        {showBrackets && (
          <nav aria-label={copy.nav.bracketsLabel} className="flex flex-wrap items-center gap-2">
            {BRACKET_SLUGS.map((slug) => (
              <Badge
                key={slug}
                asChild
                variant={slug === scope.bracket ? "secondary" : "outline"}
                className="px-3 py-1"
              >
                <Link
                  href={localizedPathname(specPath(route.spec, slug), locale)}
                  aria-current={route.bracket === slug ? "page" : undefined}
                >
                  {BRACKET_LABELS[slug]}
                </Link>
              </Badge>
            ))}
          </nav>
        )}
      </div>
    </header>
  );
}

/**
 * El resumen de una spec: `/spec/{spec}` y `/spec/{spec}/{modalidad}`.
 *
 * Son la misma vista, y la primera enseña la modalidad por defecto, que hoy es
 * la única publicada. Cuando haya dos, la de spec a secas seguirá abriendo en
 * una y la de modalidad fijará la suya.
 */
export function SpecPage({
  route,
  locale,
  data,
}: {
  route: SpecRoute;
  locale: Locale;
  data: SpecOverviewData;
}) {
  const copy = copyFor(locale).spec;
  const { scope, overview } = data;
  const bracket = BRACKET_LABELS[scope.bracket];

  return (
    <main className="mx-auto flex max-w-page flex-col gap-8 px-5 py-8 lg:px-8">
      <SpecHeader route={route} locale={locale} scope={scope} showBrackets />
      {overview === null ? (
        <EmptyNotice text={copy.empty.spec(route.spec.label, bracket)} />
      ) : (
        <>
          <OverviewFigures locale={locale} overview={overview} bracket={bracket} />
          <SpecSegmentsTable
            locale={locale}
            route={route}
            bracket={scope.bracket}
            overview={overview}
          />
          <RunProvenance locale={locale} computedAt={overview.computedAt} />
        </>
      )}
      <MethodologyLink locale={locale} />
    </main>
  );
}

/**
 * Las cifras de cabecera.
 *
 * Una cifra que no se puede afirmar no se pinta con un guion: sin el puesto en
 * la modalidad —porque los tramos son de otra corrida— la tarjeta no está, y el
 * resto de la página dice lo mismo que diría con ella.
 */
function OverviewFigures({
  locale,
  overview,
  bracket,
}: {
  locale: Locale;
  overview: SpecOverview;
  bracket: string;
}) {
  const copy = copyFor(locale).spec.figures;
  const { standing } = overview;
  const count = (value: number): string => formatCount(value, locale);

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <FigureCard value={count(overview.observed)} label={copy.observed} />
      {overview.medianSegment && (
        <FigureCard
          value={formatSegment(overview.medianSegment)}
          label={copy.medianSegment}
          note={copy.medianNote}
        />
      )}
      {overview.highestRating !== null && (
        <FigureCard value={formatRating(overview.highestRating, locale)} label={copy.highest} />
      )}
      {standing && (
        <FigureCard
          value={formatShare(standing.share, locale)}
          label={copy.share(bracket)}
          note={copy.rank(
            count(standing.population),
            count(standing.total),
            count(standing.rank),
            count(standing.of),
          )}
        />
      )}
    </div>
  );
}

/**
 * Una spec o un tramo sin nadie observado en la corrida.
 *
 * `Card` con el borde discontinuo y no `Alert`: no es algo que acabe de ocurrir,
 * ya estaba así antes de entrar en la página (§5.0 del sistema).
 */
export function EmptyNotice({ text }: { text: string }) {
  return (
    <Card className="text-muted-foreground border-dashed p-5 text-base shadow-none">{text}</Card>
  );
}

/** Al apartado de confianza, que es lo que estas páginas declaran fila a fila. */
export function MethodologyLink({ locale }: { locale: Locale }) {
  return (
    <p className="text-sm">
      <Link
        href={localizedPathname(methodologyPath("confidence"), locale)}
        className="text-primary underline"
      >
        {copyFor(locale).spec.methodology}
      </Link>
    </p>
  );
}
