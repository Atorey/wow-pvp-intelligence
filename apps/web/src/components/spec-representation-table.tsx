import {
  BRACKET_LABELS,
  BRACKET_SLUGS,
  MIN_SAMPLE_HIGH,
  MIN_SAMPLE_MEDIUM,
  formatSegment,
  specPath,
} from "@wowpvp/core";
import Link from "next/link";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatIndex, formatRating, formatShare } from "../i18n/format";
import { type Locale, localizedPathname } from "../i18n/locales";
import type { RepresentationBoard } from "../server/home-view";
import { ProportionBar } from "./proportion-bar";
import { RunProvenance } from "./run-provenance";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * Las specs de la modalidad, con qué parte de la ladder son y qué parte del
 * tramo alto.
 *
 * La pintan las dos páginas que reparten la modalidad: la portada con sus ocho
 * filas y `/meta` con las cuarenta (ADR 0038). Es el mismo cálculo y las mismas
 * notas, así que es un solo componente con un solo copy — el día que difieran
 * será porque alguien lo ha decidido, no porque una de las dos se quedara sin
 * enterarse.
 *
 * Lo único que cambia entre las dos es el tramo mediano, que solo sale en la
 * página: en la portada serían ocho columnas en una tabla que ya se queda sin
 * ancho, y el bloque de portada contesta "qué se juega", no "cómo se reparte".
 *
 * No está la columna «7 días» del mockup, y la razón ya no es la serie: desde
 * el ADR 0019 se conserva entera. Lo que falta es muestra en el tramo alto,
 * porque marcar una tendencia exige que su proporción acompañe (§17) y ninguna
 * spec llega al umbral ahí arriba (ADR 0037). No se rellena con un cero —sería
 * una variación que nadie midió— y su ausencia se declara en la nota, con la
 * cifra que le falta.
 *
 * Sin scroll horizontal (§4 del sistema): en pantalla estrecha se retiran la
 * barra y las dos columnas del tramo alto, y lo que sostiene la fila —la
 * proporción y el índice— baja debajo del nombre de la spec.
 */
export function SpecRepresentationTable({
  locale,
  board,
  showMedian = false,
}: {
  locale: Locale;
  board: RepresentationBoard;
  /** Si la fila enseña su tramo mediano: la página sí, la portada no. */
  showMedian?: boolean;
}) {
  const copy = copyFor(locale).meta.table;
  const [bracket] = BRACKET_SLUGS;
  const count = (value: number): string => formatCount(value, locale);
  const share = (value: number): string => formatShare(value, locale);
  const highFloor = formatRating(board.highFloor, locale);
  // La barra más ancha es la de la spec más jugada y no el 100 % de la
  // modalidad: cuarenta specs se reparten la ladder y ninguna llega a un
  // quinto, así que contra el total todas saldrían igual de cortas. El dato es
  // el porcentaje escrito al lado.
  const widest = Math.max(...board.rows.map((row) => row.share));

  return (
    <Card className="gap-4 p-5">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-subtle-foreground w-8">{copy.rank}</TableHead>
            <TableHead className="text-subtle-foreground whitespace-normal">{copy.spec}</TableHead>
            <TableHead className="text-subtle-foreground hidden w-1/4 lg:table-cell">
              {copy.weight}
            </TableHead>
            <TableHead className="text-subtle-foreground text-right whitespace-normal">
              {copy.observed}
            </TableHead>
            {/*
             * El tramo mediano va detrás de los observados y no al final de la
             * fila: las dos últimas columnas son las que se caen juntas cuando
             * una spec no tiene muestra arriba, y se pintan con un `colSpan`
             * que dejaría de cuadrar con una columna detrás.
             */}
            {showMedian && (
              <TableHead className="text-subtle-foreground hidden text-right whitespace-normal md:table-cell">
                {copy.medianSegment}
              </TableHead>
            )}
            <TableHead className="text-subtle-foreground hidden text-right whitespace-normal md:table-cell">
              {copy.ofLadder}
            </TableHead>
            <TableHead className="text-subtle-foreground hidden text-right whitespace-normal md:table-cell">
              {copy.ofHigh(highFloor)}
            </TableHead>
            <TableHead className="text-subtle-foreground hidden text-right md:table-cell">
              {copy.index}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {board.rows.map((row, index) => {
            const color = classColor(row.spec.classSlug);

            return (
              <TableRow key={row.spec.label}>
                <TableCell className="text-subtle-foreground font-display text-base">
                  {count(index + 1)}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {/* El color de la clase acompaña; la spec está escrita. */}
                  <Link
                    href={localizedPathname(specPath(row.spec, bracket), locale)}
                    className={`text-base underline ${color.text}`}
                  >
                    {row.spec.label}
                  </Link>
                  {/*
                   * Lo que en pantalla ancha son columnas: la proporción de la
                   * spec, su índice si lo tiene y, en la página, su tramo
                   * mediano. La proporción del tramo alto no baja aquí porque
                   * el índice ya la resume, y la fila se leería como cuatro
                   * cifras seguidas sin encabezado.
                   */}
                  <span className="text-subtle-foreground block text-xs md:hidden">
                    {[
                      share(row.share),
                      row.high && formatIndex(row.high.index, locale),
                      showMedian && row.medianSegment && formatSegment(row.medianSegment),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <ProportionBar value={row.share / widest} fill={color.fill} />
                </TableCell>
                <TableCell className="text-foreground text-right text-base">
                  {count(row.observed)}
                </TableCell>
                {showMedian && (
                  <TableCell className="text-muted-foreground hidden text-right whitespace-nowrap md:table-cell">
                    {/*
                     * Sin tramo no se escribe un guion: la celda se queda vacía
                     * porque no hay nada que decir de una spec que la corrida no
                     * reparte, y un guion se lee como una cifra que da cero.
                     */}
                    {row.medianSegment && formatSegment(row.medianSegment)}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground hidden text-right md:table-cell">
                  {share(row.share)}
                </TableCell>
                {row.high === null ? (
                  /*
                   * Una sola celda para las dos cifras que se caen juntas: las
                   * dos salen de la misma base, y decirlo dos veces en la
                   * misma fila convertiría una ausencia en un ruido.
                   */
                  <TableCell
                    colSpan={2}
                    className="text-muted-foreground hidden text-right text-sm whitespace-normal md:table-cell"
                  >
                    {copy.noHigh(count(MIN_SAMPLE_MEDIUM))}
                  </TableCell>
                ) : (
                  <>
                    <TableCell className="text-muted-foreground hidden text-right md:table-cell">
                      {share(row.high.share)}
                    </TableCell>
                    <TableCell className="text-foreground hidden text-right text-base md:table-cell">
                      {formatIndex(row.high.index, locale)}
                    </TableCell>
                  </>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>

      {/* Los umbrales llegan de `packages/core`, no tecleados. */}
      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.shareNote(count(board.observed), BRACKET_LABELS[bracket], count(board.specs))}
        </p>
        <p className="text-muted-foreground max-w-measure text-sm">{copy.indexNote(highFloor)}</p>
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.highNote(count(MIN_SAMPLE_MEDIUM), highFloor)}
        </p>
        {showMedian && (
          <p className="text-muted-foreground max-w-measure text-sm">{copy.medianNote}</p>
        )}
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.notSaid}</p>
        <p className="text-subtle-foreground max-w-measure text-sm">
          {copy.trendPending(count(MIN_SAMPLE_HIGH), highFloor)}
        </p>
        {/*
         * La quinta señal de la §17 se declara solo en la página: la portada
         * nunca prometió las cinco, y una ausencia declarada donde nadie
         * esperaba la cifra es ruido.
         */}
        {showMedian && (
          <p className="text-subtle-foreground max-w-measure text-sm">{copy.activityPending}</p>
        )}
        <p className="text-subtle-foreground max-w-measure text-sm">
          {copyFor(locale).spec.observedNote}
        </p>
        {/*
         * De qué corrida son estas cifras, como en toda cifra agregada del
         * sitio (§28 del plan). Es la misma que dice si la corrida se ha
         * quedado atrás, que aquí importa más que en ninguna otra página: la
         * portada es lo primero que se ve.
         */}
        <RunProvenance locale={locale} computedAt={board.computedAt} />
      </div>
    </Card>
  );
}
