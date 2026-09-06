import { BRACKET_LABELS, type SpecRoute, formatSegment, specPath } from "@wowpvp/core";
import type { Metadata } from "next";

import { alternatesFor } from "../i18n/alternates";
import { copyFor } from "../i18n/copy";
import type { Locale } from "../i18n/locales";
import { SPEC_PAGES_PUBLISHED, robotsFor } from "../seo/indexable";
import { type Crumb, PagePlaceholder } from "./page-placeholder";
import { SegmentNav } from "./segment-nav";

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

/** Los niveles superiores, que siempre existen si existe el de abajo. */
function trailFor(route: SpecRoute): Crumb[] {
  const trail: Crumb[] = [];
  if (route.bracket) trail.push({ path: specPath(route.spec), label: route.spec.label });
  if (route.segment && route.bracket) {
    trail.push({
      path: specPath(route.spec, route.bracket),
      label: BRACKET_LABELS[route.bracket],
    });
  }
  return trail;
}

export function specMetadata(route: SpecRoute, locale: Locale): Metadata {
  return {
    title: titleFor(route),
    description: leadFor(route, locale),
    alternates: alternatesFor(specPath(route.spec, route.bracket, route.segment), locale),
    // Mientras la página sea un armazón no hay nada que indexar, y la muestra
    // del escalón no cambia eso (ADR 0029, decisión 8). Cuando se encienda, esto
    // pasa a preguntar por la muestra de esta ruta en concreto.
    robots: robotsFor(SPEC_PAGES_PUBLISHED, process.env),
  };
}

export function SpecPage({ route, locale }: { route: SpecRoute; locale: Locale }) {
  return (
    <PagePlaceholder
      locale={locale}
      title={titleFor(route)}
      lead={leadFor(route, locale)}
      trail={trailFor(route)}
    >
      {route.bracket && route.segment && (
        <SegmentNav
          spec={route.spec}
          bracket={route.bracket}
          segment={route.segment}
          locale={locale}
        />
      )}
    </PagePlaceholder>
  );
}
