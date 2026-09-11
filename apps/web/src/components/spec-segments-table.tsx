import {
  ACTIVITY_WINDOWS,
  MIN_SAMPLE_MEDIUM,
  formatSegment,
  specPath,
  type BracketSlug,
  type SpecRoute,
} from "@wowpvp/core";
import Link from "next/link";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatShare } from "../i18n/format";
import { type Locale, localizedPathname } from "../i18n/locales";
import type { SpecOverview } from "../server/spec-view";
import { ProportionBar } from "./proportion-bar";
import { SectionCard } from "./section-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * La tabla por tramo de rating.
 *
 * Enseña a la vez los observados y los perfiles con gear, y es a propósito: son
 * las dos cifras que la columna `confidence` de la base confundía, y ponerlas
 * juntas es lo que deja ver que un tramo de mil personas puede no tener
 * comparación. La confianza de la fila sale de la segunda.
 *
 * Sin scroll horizontal (§4 del sistema): en pantalla estrecha la columna de la
 * barra se retira y su porcentaje pasa debajo del tramo, y las celdas parten
 * línea en vez de empujar la tabla fuera de la columna.
 */
export function SpecSegmentsTable({
  locale,
  route,
  bracket,
  overview,
}: {
  locale: Locale;
  route: SpecRoute;
  bracket: BracketSlug;
  overview: SpecOverview;
}) {
  const copy = copyFor(locale).spec;
  const fill = classColor(route.spec.classSlug).fill;
  const count = (value: number): string => formatCount(value, locale);
  // La barra más ancha es la del tramo más poblado y no el 100 % de la spec:
  // con diez tramos ninguno pasaría de un tercio, y las barras dejarían de
  // leerse unas contra otras. El dato es el porcentaje escrito al lado.
  const widest = Math.max(...overview.rows.map((row) => row.share));

  return (
    <SectionCard title={copy.table.title}>
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-subtle-foreground whitespace-normal">
              {copy.table.segment}
            </TableHead>
            <TableHead className="text-subtle-foreground hidden w-2/5 sm:table-cell">
              {copy.table.share}
            </TableHead>
            <TableHead className="text-subtle-foreground text-right whitespace-normal">
              {copy.table.observed}
            </TableHead>
            <TableHead className="text-subtle-foreground text-right whitespace-normal">
              {copy.table.gear}
            </TableHead>
            <TableHead className="text-subtle-foreground whitespace-normal">
              {copy.table.confidence}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {overview.rows.map((row) => (
            <TableRow key={row.segment.id}>
              <TableCell className="whitespace-normal">
                {/*
                 * Todos los tramos enlazan a su página, también los que no tienen
                 * comparación: su página dice por qué, y es el camino por el que
                 * un rastreador llega a los tramos que sí la tienen.
                 */}
                <Link
                  href={localizedPathname(specPath(route.spec, bracket, row.segment), locale)}
                  className="text-foreground font-display text-base underline"
                >
                  {formatSegment(row.segment)}
                </Link>
                <span className="text-subtle-foreground block text-xs sm:hidden">
                  {formatShare(row.share, locale)}
                </span>
              </TableCell>
              <TableCell className="hidden sm:table-cell">
                <span className="flex items-center gap-3">
                  <ProportionBar value={row.share / widest} fill={fill} />
                  <span className="text-muted-foreground w-14 shrink-0 text-right text-sm">
                    {formatShare(row.share, locale)}
                  </span>
                </span>
              </TableCell>
              <TableCell className="text-right whitespace-normal">
                <span className="text-foreground block text-base">{count(row.population)}</span>
                <span className="text-subtle-foreground block text-xs">
                  {copy.table.window(count(row.activityWindowDays))}
                </span>
              </TableCell>
              <TableCell className="text-foreground text-right text-base">
                {count(row.gearSample)}
              </TableCell>
              <TableCell
                className={`text-sm whitespace-normal ${
                  row.confidence === "insufficient" ? "text-muted-foreground" : "text-foreground"
                }`}
              >
                {copy.confidence[row.confidence]}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {/* Los umbrales y las ventanas llegan de `packages/core`, no tecleados. */}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.table.confidenceNote(count(MIN_SAMPLE_MEDIUM))}
        </p>
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.table.windowNote(
            count(ACTIVITY_WINDOWS.default),
            count(ACTIVITY_WINDOWS.fallback),
            count(MIN_SAMPLE_MEDIUM),
          )}
        </p>
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.observedNote}</p>
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.ladderCap}</p>
      </div>
    </SectionCard>
  );
}
