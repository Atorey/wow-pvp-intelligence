import { copyFor } from "../i18n/copy";
import { formatCount } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { ActiveCharactersRead } from "@wowpvp/data";
import type { ActivityWindowDays } from "@wowpvp/core";

import { BRACKET_NAMES, PUBLISHED_BRACKET, isPublishedBracket } from "./brackets";
import { RunProvenance } from "./run-provenance";
import { Card } from "./ui/card";

/**
 * Cuánta gente distinta hay en cada modalidad dentro de la ventana de
 * actividad.
 *
 * **Las cinco modalidades están, y cuatro dicen que no tienen dato.** El mockup
 * enseña cinco cifras y el pipeline ingiere una; la salida no es esconder las
 * otras cuatro, porque el titular del bloque promete "cada modalidad" y un
 * bloque con una sola fila haría pensar que las demás no existen. La §1.5 del
 * brief pide decir con palabras lo que falta, y lo que falta aquí es del tamaño
 * de cuatro quintos del bloque: no hay ninguna fila suya en la base, y eso es
 * distinto de una cifra baja.
 *
 * Tampoco está la variación semanal del mockup, por lo mismo que la tabla de
 * arriba: exige conservar la ventana anterior. No se rellena con un cero —sería
 * una variación que nadie midió— y su ausencia se declara en la nota.
 */
export function BracketPopulationList({
  locale,
  active,
  computedAt,
  windowDays,
}: {
  locale: Locale;
  active: ActiveCharactersRead;
  computedAt: Date;
  windowDays: ActivityWindowDays;
}) {
  const copy = copyFor(locale).home.population.list;
  const count = (value: number): string => formatCount(value, locale);
  const observed = count(active.observed);

  return (
    <Card className="gap-4 p-5">
      <dl className="flex flex-col gap-3">
        {BRACKET_NAMES.map((bracket) => (
          <div
            key={bracket}
            className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
          >
            <dt className="text-foreground text-base">{bracket}</dt>
            {isPublishedBracket(bracket) ? (
              <dd className="text-foreground font-display text-2xl">{observed}</dd>
            ) : (
              /*
               * La ausencia ocupa el sitio de la cifra y no una fila aparte: es
               * lo que se sabe de esa modalidad, y apartarla la dejaría leerse
               * como un hueco pendiente de cargar. En la fila va el estado y el
               * porqué va una sola vez en la nota: escrito cuatro veces, la
               * explicación se lee como ruido y deja de explicar.
               */
              <dd className="text-muted-foreground text-sm">{copy.notIngested}</dd>
            )}
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.note(observed, PUBLISHED_BRACKET, count(windowDays))}
        </p>
        {/*
         * Lo que falta, dicho con palabras y una sola vez (§1.5 del brief): no
         * es una cifra baja ni un dato que esté cargando, es que de esas cuatro
         * no hay ninguna fila.
         */}
        <p className="text-muted-foreground max-w-measure text-sm">{copy.notIngestedNote}</p>
        {/*
         * De qué está hecha la cifra. Va pegada a ella y no en la metodología
         * porque las dos partes no valen lo mismo: una es actividad vista y la
         * otra es la cota de la primera observación. Hoy manda la primera
         * —33.907 de 38.015 el 18 de septiembre de 2026—, pero esa proporción
         * es del histórico que haya, no una propiedad de la cifra: al empezar
         * una temporada se invierte, y el número no puede prometer lo mismo en
         * los dos casos (§27 del plan).
         */}
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.evidence(count(active.byDelta))}
        </p>
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.observed}</p>
        <p className="text-subtle-foreground max-w-measure text-sm">{copy.trendPending}</p>
        {/* La misma corrida que fecha el bloque de arriba (§28 del plan). */}
        <RunProvenance locale={locale} computedAt={computedAt} />
      </div>
    </Card>
  );
}
