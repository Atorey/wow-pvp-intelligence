import { copyFor } from "../i18n/copy";
import { formatCount, formatDate, formatRating } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { RatingHistoryView } from "../server/rating-history-view";
import { CountRow } from "./counted-figure";
import { RatingChart } from "./rating-chart";
import { SectionCard } from "./section-card";
import { SmallSampleNotice } from "./small-sample-notice";
import { Separator } from "./ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./ui/table";

/**
 * La pestaña de histórico: el rating de una spec a lo largo de la temporada
 * (ADR 0039).
 *
 * Tres cifras, el gráfico y la tabla, en ese orden. Las cifras van **encima** y
 * no como etiquetas sobre la línea: principio, máximo y final son lo que se
 * busca en una serie, y escritas aparte no se pisan con los puntos en un móvil.
 * El máximo es el mismo número que la ficha llama "máximo observado", y sale de
 * la misma serie, así que no pueden no coincidir.
 *
 * Lo que no hay aquí es cualquier cosa que relacione la curva con otra: ni el
 * equipo ni los talentos de cada momento al lado. Puestos junto a una subida se
 * leerían como su causa (regla 3).
 */
export function RatingHistory({
  locale,
  spec,
  color,
  history,
}: {
  locale: Locale;
  spec: string;
  /** La utilidad de texto de la clase, de `classColor()`. */
  color: string;
  history: RatingHistoryView;
}) {
  const player = copyFor(locale).player;
  const copy = player.history;
  const { points, gap } = history;
  const first = points[0];
  const latest = points[points.length - 1];
  // El último de los empatados, igual que en el gráfico.
  const highest = points.reduce<(typeof points)[number] | undefined>(
    (best, point) => (best === undefined || point.rating >= best.rating ? point : best),
    undefined,
  );
  const at = (point: { at: Date; rating: number }): string =>
    copy.at(formatRating(point.rating, locale), formatDate(point.at, locale));

  return (
    <SectionCard title={copy.title(spec)}>
      {gap !== null && (
        <SmallSampleNotice text={copy.gap[gap.cause](formatCount(gap.missing, locale))} />
      )}

      {points.length === 1 && first && (
        <p className="text-foreground text-base">
          {copy.single(formatRating(first.rating, locale), formatDate(first.at, locale))}
        </p>
      )}

      {points.length >= 2 && first && latest && highest && (
        <>
          <div className="flex flex-col gap-2">
            <CountRow label={copy.observations} value={formatCount(points.length, locale)} />
            <CountRow label={copy.first} value={at(first)} />
            <CountRow label={copy.highest} value={at(highest)} />
            <CountRow label={copy.latest} value={at(latest)} />
          </div>
          <Separator />
          <figure className="flex flex-col gap-3">
            <RatingChart locale={locale} points={points} color={color} />
            <figcaption className="text-subtle-foreground text-sm">{copy.line}</figcaption>
          </figure>
          {/*
           * El gemelo del gráfico. Plegado con `<details>` y no con el
           * `Collapsible` de shadcn por lo mismo que las listas de adopción: se
           * abre sin script y lo plegado está en el HTML.
           */}
          <details>
            <summary className="text-primary cursor-pointer py-1.5 text-sm underline">
              {copy.table.toggle(formatCount(points.length, locale))}
            </summary>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{copy.table.date}</TableHead>
                  <TableHead className="text-right">{copy.table.rating}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {/* Lo más reciente arriba: es lo primero que se busca en una lista larga. */}
                {[...points].reverse().map((point) => (
                  <TableRow key={point.at.getTime()}>
                    <TableCell>{formatDate(point.at, locale)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatRating(point.rating, locale)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </details>
        </>
      )}

      <p className="text-subtle-foreground text-sm">{player.standing.observedNote}</p>
    </SectionCard>
  );
}
