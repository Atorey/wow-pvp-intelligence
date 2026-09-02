"use client";

import { playerPath, type Region } from "@wowpvp/core";
import type { CharacterSuggestion } from "@wowpvp/data";
import { SearchIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { rememberSearch } from "../design/recent-searches";
import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";
import { submitSearch } from "../server/actions";
import { optionId } from "./suggestion-panel";
import { SuggestionList } from "./suggestion-list";
import { Popover, PopoverAnchor } from "./ui/popover";
import { useSuggestionNavigation, useSuggestions } from "./use-suggestions";

/**
 * El buscador de la barra lateral: un solo campo, el nombre.
 *
 * Llega justo hasta donde puede llegar un campo único, y ni un paso más. Sobre
 * **nuestra población** basta el nombre: la búsqueda por prefijo devuelve los
 * homónimos con su reino y elegir uno resuelve la identidad sin gastar cuota.
 * Lo que no puede es el fallback: preguntarle a Blizzard por un personaje que no
 * tenemos exige un reino, porque su API no acepta un nombre suelto.
 *
 * Por eso enviar sin haber elegido sugerencia **no llama a Blizzard**: cae en
 * /search con el estado `incomplete`, que es la página que explica que falta el
 * reino y ofrece el buscador de dos campos. Es un atajo para lo que ya
 * conocemos, no un segundo buscador con las mismas capacidades que el de la
 * portada.
 */
export function QuickSearch({ locale, region }: { locale: Locale; region: Region }) {
  const copy = copyFor(locale).search;
  const router = useRouter();
  const listId = useId();

  const [name, setName] = useState("");
  const [dismissed, setDismissed] = useState(false);
  const { suggestions, status, open } = useSuggestions(name);

  function go(suggestion: CharacterSuggestion): void {
    rememberSearch({
      realmSlug: suggestion.realmSlug,
      nameSlug: suggestion.nameSlug,
      nameDisplay: suggestion.nameDisplay,
      specSlug: suggestion.specSlug,
      rating: suggestion.rating,
    });

    setName("");
    router.push(
      localizedPathname(
        playerPath({ region, realmSlug: suggestion.realmSlug, nameSlug: suggestion.nameSlug }),
        locale,
      ),
    );
  }

  const keys = useSuggestionNavigation(suggestions, go);
  const showNames = open && !dismissed;

  return (
    <form action={submitSearch} className="flex">
      <input type="hidden" name="locale" value={locale} />
      {/*
       * El reino viaja vacío a propósito. La Server Action lo comprueba y
       * redirige sin preguntarle nada a Blizzard: un campo único no puede
       * saberlo, y adivinarlo gastaría cuota compartida con el pipeline.
       */}
      <input type="hidden" name="realm" value="" />

      <Popover
        open={showNames}
        onOpenChange={(next) => {
          if (!next) setDismissed(true);
        }}
      >
        <div className="relative w-full">
          {/*
           * La lupa es decorativa: `aria-hidden` y sin texto propio, porque el
           * campo ya lleva su `aria-label`. Un icono que además fuera la
           * etiqueta dejaría el campo sin nombre para quien no lo ve.
           */}
          <SearchIcon
            aria-hidden="true"
            className="text-subtle-foreground pointer-events-none absolute top-1/2 left-3 z-10 size-4 -translate-y-1/2"
          />

          <PopoverAnchor asChild>
            <input
              name="name"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                setDismissed(false);
              }}
              onKeyDown={keys.onKeyDown}
              placeholder={copy.quickPlaceholder}
              aria-label={copy.quickLabel}
              autoComplete="off"
              required
              role="combobox"
              aria-expanded={showNames}
              aria-controls={listId}
              aria-autocomplete="list"
              {...(keys.active >= 0
                ? { "aria-activedescendant": optionId(listId, keys.active) }
                : {})}
              className="border-border bg-accent text-foreground placeholder:text-subtle-foreground w-full rounded border py-2 pr-3 pl-9 text-sm"
            />
          </PopoverAnchor>
        </div>

        {/*
         * Flotante y no en el flujo: en la columna lateral, empujar la
         * navegación hacia abajo al teclear mueve bajo el cursor lo que el
         * visitante estaba a punto de pulsar. Antes era un `absolute` a mano;
         * ahora lo coloca `Popover`, que además lo saca del `overflow-y-auto`
         * de la barra, donde se recortaba al llegar abajo.
         */}
        <SuggestionList
          locale={locale}
          listId={listId}
          suggestions={suggestions}
          status={status}
          active={keys.active}
          onHover={keys.setActive}
          onPick={go}
          dense
        />
      </Popover>
    </form>
  );
}
