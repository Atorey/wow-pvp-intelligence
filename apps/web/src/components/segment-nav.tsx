import {
  type BracketSlug,
  type RatingSegment,
  type SpecEntry,
  formatSegment,
  nextSegment,
  previousSegment,
  specPath,
} from "@wowpvp/core";
import Link from "next/link";

import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";

/**
 * Los dos escalones contiguos de la misma spec y modalidad.
 *
 * §22 lo pide por dos razones que apuntan al mismo sitio: refuerza la narrativa
 * de progresión —el producto entero va de "el siguiente escalón", no de la
 * cima— y es el único camino por el que un rastreador llega a una página de
 * segmento, porque ninguna otra enlaza hacia abajo en la jerarquía. Los niveles
 * de arriba los pone la miga de pan, así que aquí no se repiten.
 *
 * Los bordes se caen solos: el tramo de abajo no tiene anterior y el abierto de
 * arriba no tiene siguiente, y eso lo decide la escala en `@wowpvp/core`.
 */
export function SegmentNav({
  spec,
  bracket,
  segment,
  locale,
}: {
  spec: SpecEntry;
  bracket: BracketSlug;
  segment: RatingSegment;
  locale: Locale;
}) {
  const copy = copyFor(locale).spec;
  const below = previousSegment(segment);
  const above = nextSegment(segment);

  if (!below && !above) return null;

  const link = (label: string, target: RatingSegment) => (
    <Link
      href={localizedPathname(specPath(spec, bracket, target), locale)}
      className="text-muted-foreground hover:text-foreground flex flex-col gap-0.5"
    >
      <span className="text-subtle-foreground text-xs">{label}</span>
      <span className="text-base">{formatSegment(target)}</span>
    </Link>
  );

  return (
    <nav
      aria-label={copyFor(locale).nav.segmentsLabel}
      className="border-border flex justify-between gap-4 border-t pt-4"
    >
      {below ? link(copy.previousSegment, below) : <span />}
      {above && link(copy.nextSegment, above)}
    </nav>
  );
}
