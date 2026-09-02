"use client";

import { parseSpecSlug, playerPath, type Region } from "@wowpvp/core";
import Link from "next/link";
import { useEffect, useState } from "react";

import { classColor } from "../design/class-color";
import { type RecentSearch, readRecent } from "../design/recent-searches";
import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";
import { Card, CardContent } from "./ui/card";

/**
 * Las tarjetas de "búsquedas anteriores" de la portada.
 *
 * No se renderiza nada en el servidor —`localStorage` no existe allí— y por eso
 * el estado arranca vacío y se llena en un efecto: pintar tarjetas en el HTML
 * que el cliente luego cambia es exactamente el desajuste de hidratación que
 * React avisa, y aquí además enseñaría las búsquedas de otro visitante si la
 * página se cacheara.
 *
 * Cuando no hay ninguna, la sección **no existe**: un bloque vacío titulado
 * "búsquedas anteriores" en la primera visita es ruido, no un estado. Los
 * estados vacíos que sí se declaran son los de las lecturas de datos, donde
 * falta una cifra que el visitante espera (brief §1.5).
 */
export function RecentSearches({ locale, region }: { locale: Locale; region: Region }) {
  const copy = copyFor(locale).home.recent;
  const [recent, setRecent] = useState<RecentSearch[]>([]);

  useEffect(() => {
    setRecent(readRecent());
  }, []);

  if (recent.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-subtle-foreground tracking-caps font-display text-xs uppercase">
        {copy.title}
      </h2>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {recent.map((entry) => {
          const spec = entry.specSlug ? parseSpecSlug(entry.specSlug) : undefined;
          const color = classColor(spec?.classSlug);

          return (
            <li key={`${entry.realmSlug}/${entry.nameSlug}`}>
              <Link
                href={localizedPathname(
                  playerPath({ region, realmSlug: entry.realmSlug, nameSlug: entry.nameSlug }),
                  locale,
                )}
                className="block h-full no-underline"
              >
                {/*
                 * El filete de color va fuera de `CardContent` y a mano: es el
                 * borde superior de la tarjeta, no contenido, y ninguna
                 * librería tiene un color de clase de personaje.
                 *
                 * Lleva el color de clase, y el nombre también. Acompaña, no
                 * informa: quitarle el color a la tarjeta no le quita nada,
                 * porque la clase está escrita debajo.
                 */}
                <Card className="hover:border-input h-full gap-0 overflow-hidden p-0">
                  <span className={`${color.fill} block h-0.5`} />

                  <CardContent className="flex flex-col gap-2 p-4">
                    <span className="flex flex-col gap-0.5">
                      <span className={`${color.text} font-display text-lg`}>
                        {entry.nameDisplay}
                      </span>
                      <span className="text-subtle-foreground text-xs">
                        {spec ? `${spec.label} · ${entry.realmSlug}` : entry.realmSlug}
                      </span>
                    </span>
                    {/*
                     * Sin rating no se escribe un cero: al personaje le falta la
                     * observación, no el rating.
                     */}
                    {entry.rating !== null && (
                      <span className="text-foreground font-display text-xl">{entry.rating}</span>
                    )}
                  </CardContent>
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
