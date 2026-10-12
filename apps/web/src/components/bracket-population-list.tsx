import { copyFor } from "../i18n/copy";
import { formatCount } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { ActiveCharactersRead } from "@wowpvp/data";
import {
  BRACKET_LABELS,
  type ActivityWindowDays,
  type ArenaBracket,
  type BracketSlug,
} from "@wowpvp/core";

import { formatList } from "../i18n/format";
import { BRACKETS, isPublished } from "./brackets";
import { RunProvenance } from "./run-provenance";
import { Card } from "./ui/card";

/**
 * Cuánta gente distinta hay en cada modalidad dentro de la ventana de
 * actividad.
 *
 * **Las cinco modalidades están, y las que no se leen dicen que no tienen dato.**
 * El mockup enseña cinco cifras y el pipeline ingiere Solo Shuffle y la arena
 * que su interruptor encienda (ADR 0048); la salida no es esconder las demás,
 * porque el titular del bloque promete "cada modalidad" y un bloque sin ellas
 * haría pensar que no existen. La §1.5 del brief pide decir con palabras lo que
 * falta: no hay ninguna fila suya en la base, y eso es distinto de una cifra
 * baja.
 *
 * Tampoco está la variación semanal del mockup, y aquí el motivo es propio y no
 * el de la tabla de arriba: esta cifra cuenta personajes distintos, y
 * `character_activity` guarda una fila por personaje con su última observación
 * —clave `(character_id, bracket, season_id)`, migración 0006—, no una por
 * ventana. Quien jugó las dos semanas solo conserva la fecha más reciente, así
 * que recontar hoy la ventana anterior dejaría fuera justo a quien siguió
 * jugando. No se rellena con un cero —sería una variación que nadie midió— y su
 * ausencia se declara en la nota.
 */
export function BracketPopulationList({
  locale,
  active,
  arena,
  published,
  computedAt,
  windowDays,
}: {
  locale: Locale;
  /** Solo Shuffle. */
  active: ActiveCharactersRead;
  /** La arena publicada, cada modalidad con su cifra. */
  arena: readonly { slug: ArenaBracket; active: ActiveCharactersRead }[];
  published: readonly BracketSlug[];
  computedAt: Date;
  windowDays: ActivityWindowDays;
}) {
  const copy = copyFor(locale).home.population.list;
  const count = (value: number): string => formatCount(value, locale);
  const observed = count(active.observed);
  const figureOf = (slug: BracketSlug): string | null => {
    if (slug === "solo-shuffle") return observed;
    const entry = arena.find((candidate) => candidate.slug === slug);
    return entry ? count(entry.active.observed) : null;
  };
  const unread = BRACKETS.filter((entry) => !isPublished(entry, published));

  return (
    <Card className="gap-4 p-5">
      <dl className="flex flex-col gap-3">
        {BRACKETS.map((entry) => {
          const figure = isPublished(entry, published) ? figureOf(entry.slug) : null;
          return (
            <div
              key={entry.name}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1"
            >
              <dt className="text-foreground text-base">{entry.name}</dt>
              {figure !== null ? (
                <dd className="text-foreground font-display text-2xl">{figure}</dd>
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
          );
        })}
      </dl>

      <div className="flex flex-col gap-2">
        <p className="text-muted-foreground max-w-measure text-sm">
          {copy.note(observed, BRACKET_LABELS["solo-shuffle"], count(windowDays))}
        </p>
        {/*
         * La arena se cuenta igual pero no se suma igual: su bracket es uno para
         * todas las specs, así que no hay specs que sumar dos veces, y su corte
         * del leaderboard es el del bracket entero (ADR 0048).
         */}
        {arena.length > 0 && (
          <p className="text-muted-foreground max-w-measure text-sm">
            {copy.arenaNote(
              formatList(
                arena.map((entry) => BRACKET_LABELS[entry.slug]),
                locale,
              ),
            )}
          </p>
        )}
        {/*
         * Lo que falta, dicho con palabras y una sola vez (§1.5 del brief): no
         * es una cifra baja ni un dato que esté cargando, es que de esas no hay
         * ninguna fila.
         */}
        {unread.length > 0 && (
          <p className="text-muted-foreground max-w-measure text-sm">
            {copy.notIngestedNote(
              formatList(
                unread.map((entry) => entry.name),
                locale,
              ),
            )}
          </p>
        )}
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
