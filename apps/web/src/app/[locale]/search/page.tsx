import { getRegion } from "@wowpvp/blizzard";
import { isSearchStatus, playerPath, type SearchStatus } from "@wowpvp/core";
import type { CharacterSuggestion } from "@wowpvp/data";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CharacterSearch } from "../../../components/character-search";
import { copyFor } from "../../../i18n/copy";
import { isLocale, localizedPathname, type Locale } from "../../../i18n/locales";
import { suggestExact } from "../../../server/search";

interface SearchParams {
  realm?: string;
  name?: string;
  status?: string;
}

/**
 * Dónde aterriza un envío del buscador que no llevó a un perfil (ADR 0024).
 *
 * Lo que **no** hace es volver a preguntarle a Blizzard: el resultado viaja en
 * la URL precisamente por eso. Un `GET` que gastara cuota la gastaría también
 * en cada refresco, en cada compartición del enlace y en cada precarga del
 * navegador. Aquí solo se lee población, que es gratis.
 */

/**
 * Nunca se indexa: su contenido es la consulta de una persona, no una página
 * del catálogo, y §22 solo indexa lo que tiene contenido propio. Tampoco lleva
 * `alternates`: los hreflang declaran equivalencias entre páginas del catálogo,
 * y esta no está en él.
 */
const NOINDEX = { index: false, follow: false } as const;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return { robots: NOINDEX };

  return { robots: NOINDEX, title: copyFor(locale).search.title };
}

function Candidates({
  locale,
  candidates,
}: {
  locale: Locale;
  candidates: readonly CharacterSuggestion[];
}) {
  const region = getRegion();
  const copy = copyFor(locale).search;

  return (
    <ul className="border-border divide-border divide-y rounded border">
      {candidates.map((candidate) => (
        <li key={`${candidate.realmSlug}/${candidate.nameSlug}`}>
          <Link
            href={localizedPathname(
              playerPath({
                region,
                realmSlug: candidate.realmSlug,
                nameSlug: candidate.nameSlug,
              }),
              locale,
            )}
            className="hover:bg-accent flex items-baseline justify-between gap-3 px-3 py-2"
          >
            {/*
             * El nombre va con sus acentos, que es lo que distingue a estos
             * candidatos entre sí: plegarlo aquí borraría justo la diferencia
             * que obliga a elegir (ADR 0017).
             */}
            <span className="text-foreground text-base underline">
              {candidate.nameDisplay}
              <span className="text-muted-foreground"> · {candidate.realmSlug}</span>
            </span>
            <span className="text-muted-foreground text-xs">
              {candidate.rating === null
                ? copy.noRating
                : `${candidate.rating}${candidate.specSlug ? ` · ${candidate.specSlug}` : ""}`}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const query = await searchParams;
  const copy = copyFor(locale).search;

  const realm = query.realm?.trim() ?? "";
  const name = query.name?.trim() ?? "";
  const status: SearchStatus | "incomplete" =
    !realm || !name
      ? "incomplete"
      : query.status && isSearchStatus(query.status)
        ? query.status
        : "ambiguous";

  // Solo el caso de varios candidatos necesita releer, y se relee de la
  // población: los otros dos ya vienen resueltos en la URL.
  const candidates = status === "ambiguous" ? await suggestExact(name, realm) : [];

  // El copy no puede llevar la clave "not-found" con guion: es el valor que
  // viaja en la URL, no un identificador.
  const MESSAGES = {
    incomplete: copy.incomplete,
    ambiguous: copy.ambiguous,
    "not-found": copy.notFound,
    unavailable: copy.unavailable,
  } as const;
  const message = MESSAGES[status];

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-8">
      {/*
       * Sigue siendo un `<h1>` y un párrafo, y no una `Alert`: el mensaje es el
       * contenido de esta página, no algo que le ha ocurrido encima. Envolverlo
       * en una región viva lo haría anunciar dos veces —una por la navegación y
       * otra por el `role="alert"`— y, peor, dejaría la página sin encabezado.
       */}
      <h1 className="text-foreground text-2xl">{message.title}</h1>
      <p className="text-muted-foreground text-base">{message.body}</p>

      {status === "ambiguous" && candidates.length > 0 && (
        <Candidates locale={locale} candidates={candidates} />
      )}

      {/*
       * El buscador vuelve a salir aquí, y no un enlace a la portada: quien ha
       * llegado a esta pantalla tiene algo que corregir, y mandarle atrás le
       * hace teclearlo todo otra vez.
       */}
      <CharacterSearch locale={locale} region={getRegion()} />
    </main>
  );
}
