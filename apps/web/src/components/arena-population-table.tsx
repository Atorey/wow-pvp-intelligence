import { BRACKET_LABELS, formatSegment } from "@wowpvp/core";

import { copyFor } from "../i18n/copy";
import { formatCount } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { ArenaBoard } from "../server/meta-view";
import { RunProvenance } from "./run-provenance";
import { Card } from "./ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * La población de un bracket de arena por tramo, en `/meta/{arena}`.
 *
 * Dos columnas de recuento y ninguna de reparto (ADR 0048): con spec conocida
 * y sin ella. La primera no se desglosa por spec aquí porque cuánto pesa cada
 * spec depende de a quién se le ha bajado el perfil; la segunda está para que
 * la primera no se lea como toda la modalidad.
 */
export function ArenaPopulationTable({ locale, board }: { locale: Locale; board: ArenaBoard }) {
  const copy = copyFor(locale).meta.arena;
  const count = (value: number | null): string =>
    value === null ? copy.unknown : formatCount(value, locale);
  const bracket = BRACKET_LABELS[board.bracket];

  return (
    <Card className="gap-4 p-5">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="text-subtle-foreground">{copy.segment}</TableHead>
            <TableHead className="text-subtle-foreground text-right whitespace-normal">
              {copy.withSpec}
            </TableHead>
            <TableHead className="text-subtle-foreground text-right whitespace-normal">
              {copy.withoutSpec}
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {board.rows.map((row) => (
            <TableRow key={row.segment.id}>
              <TableCell className="text-foreground font-display text-base">
                {formatSegment(row.segment)}
              </TableCell>
              <TableCell className="text-foreground text-right">{count(row.withSpec)}</TableCell>
              <TableCell className="text-muted-foreground text-right">
                {count(row.withoutSpec)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.totals(count(board.withSpec), count(board.withoutSpec), bracket)}
        </p>
        {/* Sin reparto por spec, y se dice por qué en vez de dejar la tabla sin él. */}
        <p className="text-muted-foreground max-w-measure text-sm">{copy.noSplit}</p>
        <p className="text-muted-foreground max-w-measure text-sm">{copy.windows}</p>
        {/*
         * El tope es del bracket entero y en arena se llena siempre: es lo que
         * hace de toda la tabla un suelo (ADR 0045).
         */}
        {board.capped && board.leaderboardEntries !== null && (
          <p className="text-muted-foreground max-w-measure text-sm">
            {copy.capped(formatCount(board.leaderboardEntries, locale), bracket)}
          </p>
        )}
        <p className="text-subtle-foreground max-w-measure text-sm">
          {copyFor(locale).spec.ladderCapArena(bracket)}
        </p>
        <RunProvenance locale={locale} computedAt={board.computedAt} />
      </div>
    </Card>
  );
}
