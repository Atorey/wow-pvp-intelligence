"use client";

import { playerPath, type Region } from "@wowpvp/core";
import type { CharacterSuggestion } from "@wowpvp/data";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { rememberSearch } from "../design/recent-searches";
import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";
import { submitSearch } from "../server/actions";
import { OPTION, SuggestionOption, SuggestionPanel, optionId } from "./suggestion-panel";
import { SuggestionList } from "./suggestion-list";
import { Button } from "./ui/button";
import { Popover, PopoverAnchor } from "./ui/popover";
import {
  filterRealms,
  useKnownRealms,
  useSuggestionNavigation,
  useSuggestions,
} from "./use-suggestions";

/**
 * El buscador de personaje de la portada (§21 y §23 del plan).
 *
 * Es un `<form>` de verdad con una Server Action detrás, así que **funciona sin
 * JavaScript**: escribir reino y nombre y enviar lleva al perfil o a /search.
 * Lo que añade el cliente son las sugerencias mientras se teclea, que es una
 * comodidad y no la feature — si el script no carga, la búsqueda sigue.
 *
 * Los dos campos son `<input name>` de verdad y no el Combobox de shadcn, que
 * los sustituye por un botón: eso rompería el envío sin script, y con él la
 * única escritura que tiene la web (ADR 0025, decisión 6). De la librería se usa
 * `Popover` para el desplegable, que es lo que aporta cerrar con Escape y al
 * pulsar fuera.
 *
 * Dos campos y no uno porque el fallback lo exige: cuando el personaje no está
 * en nuestra población hay que preguntarle a Blizzard, y su API no sabe buscar
 * por nombre suelto. Un campo único dejaría sin respuesta justo el caso que
 * justifica la feature — el buscador de la barra lateral es de un campo y por
 * eso llega hasta donde llega (ver `QuickSearch`).
 *
 * El reino se autocompleta pero **no es un `select`**: la lista de reinos sale
 * de nuestra población, no del catálogo de Blizzard, así que cerrarla a esos
 * valores dejaría fuera precisamente al visitante cuyo reino todavía no
 * conocemos, que es de quien más falta hace preguntar. Es un campo de texto con
 * ayuda, y lo tecleado a mano vale igual.
 *
 * Visualmente los dos campos y el botón son **una sola barra**, y por eso las
 * etiquetas de campo no van escritas encima sino en el `placeholder` y en un
 * `aria-label`: dos etiquetas en versalita sobre una barra segmentada la parten
 * en tres controles sueltos, que es lo contrario de lo que el diseño dice. La
 * etiqueta accesible sigue estando, que es lo que no se puede quitar.
 */

/**
 * Un segmento de la barra. Los campos comparten borde con el de al lado —de ahí
 * el `border-r-0`— para que entre dos campos haya una línea y no dos.
 *
 * `focus-visible:relative` y el `z-10` son lo que hace visible el anillo de
 * foco: sin ellos el segmento siguiente se pinta encima y le come el lado
 * derecho, que es justo el borde que dice dónde está el cursor.
 */
const SEGMENT =
  "border-input bg-card text-foreground placeholder:text-subtle-foreground min-w-0 w-full border px-4 py-3 text-base focus-visible:relative focus-visible:z-10 sm:border-r-0";

export function CharacterSearch({ locale, region }: { locale: Locale; region: Region }) {
  const copy = copyFor(locale).search;
  const router = useRouter();
  const realmListId = useId();
  const nameListId = useId();

  const [realm, setRealm] = useState("");
  const [name, setName] = useState("");
  const [realmOpen, setRealmOpen] = useState(false);
  /*
   * Haber cerrado el desplegable de nombres a mano —con Escape o pulsando
   * fuera— es un estado aparte de "hay sugerencias que enseñar": sin él, el
   * desplegable volvería a abrirse solo en cuanto llegara la siguiente
   * respuesta, y cerrarlo no serviría de nada. Teclear otra vez lo reabre.
   */
  const [namesDismissed, setNamesDismissed] = useState(false);

  const realms = useKnownRealms();
  const realmMatches = filterRealms(realms, realm);
  const { suggestions, status, open } = useSuggestions(name, realm);

  function pickRealm(slug: string): void {
    setRealm(slug);
    setRealmOpen(false);
  }

  function go(suggestion: CharacterSuggestion): void {
    // Se anota solo al elegir una sugerencia, porque solo entonces se conoce la
    // identidad canónica. Guardar lo tecleado dejaría en la portada tarjetas que
    // enlazan a un personaje que puede no existir.
    rememberSearch({
      realmSlug: suggestion.realmSlug,
      nameSlug: suggestion.nameSlug,
      nameDisplay: suggestion.nameDisplay,
      specSlug: suggestion.specSlug,
      rating: suggestion.rating,
    });

    router.push(
      localizedPathname(
        playerPath({
          region,
          realmSlug: suggestion.realmSlug,
          nameSlug: suggestion.nameSlug,
        }),
        locale,
      ),
    );
  }

  const realmKeys = useSuggestionNavigation(realmMatches, pickRealm);
  const nameKeys = useSuggestionNavigation(suggestions, go);

  const showRealms = realmOpen && realmMatches.length > 0;
  const showNames = open && !namesDismissed;

  return (
    <div className="flex flex-col gap-3">
      <form action={submitSearch}>
        <input type="hidden" name="locale" value={locale} />

        <div className="flex flex-col sm:flex-row sm:items-stretch">
          {/*
           * La región se enseña y no se elige: el MVP publica una sola (regla 6
           * del proyecto, multi-región es V3). Un desplegable con una sola
           * opción promete las otras tres. En móvil desaparece porque ahí la
           * barra ya ocupa toda la pantalla y el ámbito lo dice la cabecera.
           */}
          <span className="border-input bg-accent text-muted-foreground tracking-caps font-display hidden items-center rounded-l-xl border border-r-0 px-4 text-sm uppercase sm:flex">
            {region.toUpperCase()}
          </span>

          <div className="sm:w-56 sm:shrink-0">
            <Popover open={showRealms} onOpenChange={setRealmOpen}>
              <PopoverAnchor asChild>
                <input
                  name="realm"
                  value={realm}
                  onChange={(event) => {
                    setRealm(event.target.value);
                    setRealmOpen(true);
                  }}
                  onFocus={() => setRealmOpen(true)}
                  onKeyDown={realmKeys.onKeyDown}
                  placeholder={copy.realmPlaceholder}
                  aria-label={copy.realmLabel}
                  autoComplete="off"
                  required
                  role="combobox"
                  aria-expanded={showRealms}
                  aria-controls={realmListId}
                  aria-autocomplete="list"
                  /*
                   * Lo que el lector de pantalla lee al mover las flechas. El
                   * foco no se va del campo, así que sin esto la opción
                   * resaltada no se anuncia y las flechas no dicen nada.
                   */
                  {...(realmKeys.active >= 0
                    ? { "aria-activedescendant": optionId(realmListId, realmKeys.active) }
                    : {})}
                  className={`${SEGMENT} rounded-t-xl sm:rounded-none`}
                />
              </PopoverAnchor>

              <SuggestionPanel listId={realmListId} label={copy.realmLabel}>
                {realmMatches.map((slug, index) => (
                  <SuggestionOption
                    key={slug}
                    listId={realmListId}
                    index={index}
                    active={index === realmKeys.active}
                    onHover={realmKeys.setActive}
                    onPick={() => pickRealm(slug)}
                    className={`${OPTION} text-foreground text-sm`}
                  >
                    {slug}
                  </SuggestionOption>
                ))}
              </SuggestionPanel>
            </Popover>
          </div>

          <div className="sm:flex-1">
            <Popover
              open={showNames}
              onOpenChange={(next) => {
                if (!next) setNamesDismissed(true);
              }}
            >
              <PopoverAnchor asChild>
                <input
                  name="name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setNamesDismissed(false);
                  }}
                  onKeyDown={nameKeys.onKeyDown}
                  placeholder={copy.namePlaceholder}
                  autoComplete="off"
                  required
                  aria-label={copy.nameLabel}
                  role="combobox"
                  aria-expanded={showNames}
                  aria-controls={nameListId}
                  aria-autocomplete="list"
                  {...(nameKeys.active >= 0
                    ? { "aria-activedescendant": optionId(nameListId, nameKeys.active) }
                    : {})}
                  className={`${SEGMENT} border-t-0 sm:border-t`}
                />
              </PopoverAnchor>

              <SuggestionList
                locale={locale}
                listId={nameListId}
                suggestions={suggestions}
                status={status}
                active={nameKeys.active}
                onHover={nameKeys.setActive}
                onPick={go}
              />
            </Popover>
          </div>

          {/*
           * `type="submit"` explícito y no por defecto: este botón es el
           * fallback entero del ADR 0024 —lo que le pregunta a Blizzard por un
           * personaje que no tenemos— y no un accesorio del autocompletado.
           */}
          {/*
           * `h-auto` y el borde no son adorno: `Button` viene con una altura
           * fija (`h-9`) y sin borde, y los dos campos de al lado miden lo que
           * mide su texto más su borde de 1px. Con la altura fija el botón
           * queda más bajo que la barra y el `items-stretch` del contenedor no
           * puede hacer nada; sin borde, la fila mide 2px menos por ese
           * segmento y la barra deja de tener un solo canto.
           */}
          <Button
            type="submit"
            className="tracking-caps font-display border-primary h-auto rounded-none rounded-b-xl border px-6 py-3 text-base uppercase sm:rounded-r-xl sm:rounded-bl-none"
          >
            {copy.submit}
          </Button>
        </div>
      </form>
    </div>
  );
}
