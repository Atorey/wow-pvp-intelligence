import { BRACKET_LABELS, BRACKET_SLUGS, MIN_SAMPLE_MEDIUM, specPath } from "@wowpvp/core";
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
 * Las specs más observadas de la modalidad, con qué parte de la ladder son y
 * qué parte del tramo alto.
 *
 * Es el subconjunto de portada de la página `/meta`, que no existe: por eso la
 * tabla **no enlaza a "las 40 specs"** como el mockup. Una ruta declarada y sin
 * código (ADR 0020, decisión 5) sería un enlace a un 404, que promete un dato
 * que no hay. Cada fila sí enlaza a su spec, que es página desde #112, y la
 * barra lateral despliega las cuarenta.
 *
 * Tampoco está la columna «7 días» del mockup: la variación exige conservar la
 * serie de corridas y esa decisión todavía no está tomada. No se rellena con un
 * cero —sería una variación medida que nadie midió— y su ausencia se declara en
 * la nota, no se disimula.
 *
 * Sin scroll horizontal (§4 del sistema): en pantalla estrecha se retiran la
 * barra y las dos columnas del tramo alto, y lo que sostiene la fila —la
 * proporción y el índice— baja debajo del nombre de la spec.
 */
export function SpecRepresentationTable({
  locale,
  board,
}: {
  locale: Locale;
  board: RepresentationBoard;
}) {
  const copy = copyFor(locale).home.meta.table;
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
                   * spec y, si la tiene, su índice. La proporción del tramo
                   * alto no baja aquí porque el índice ya la resume y la fila
                   * se leería como cuatro cifras seguidas sin encabezado.
                   */}
                  <span className="text-subtle-foreground block text-xs md:hidden">
                    {row.high === null
                      ? share(row.share)
                      : `${share(row.share)} · ${formatIndex(row.high.index, locale)}`}
                  </span>
                </TableCell>
                <TableCell className="hidden lg:table-cell">
                  <ProportionBar value={row.share / widest} fill={color.fill} />
                </TableCell>
                <TableCell className="text-foreground text-right text-base">
                  {count(row.observed)}
                </TableCell>
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
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.notSaid}</p>
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.trendPending}</p>
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
