"use client";

import { parseSpecSlug } from "@wowpvp/core";
import type { CharacterSuggestion } from "@wowpvp/data";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import type { Locale } from "../i18n/locales";
import { OPTION, SuggestionOption, SuggestionPanel } from "./suggestion-panel";
import type { SuggestionStatus } from "./use-suggestions";

/**
 * La lista de sugerencias, sin estado propio.
 *
 * La comparten los dos buscadores. El nombre va en el color de su clase, que
 * acompaña y no informa: la spec y el reino están escritos al lado, así que
 * quien no distinga los colores recibe exactamente lo mismo.
 */
export function SuggestionList({
  locale,
  listId,
  suggestions,
  status,
  active,
  onHover,
  onPick,
  /** Compacta: sin reino ni spec en línea, para la barra lateral. */
  dense = false,
}: {
  locale: Locale;
  listId: string;
  suggestions: readonly CharacterSuggestion[];
  status: SuggestionStatus;
  active: number;
  onHover: (index: number) => void;
  onPick: (suggestion: CharacterSuggestion) => void;
  dense?: boolean;
}) {
  const copy = copyFor(locale).search;

  return (
    <SuggestionPanel
      listId={listId}
      label={copy.suggestionsLabel}
      note={
        status === "loading" && suggestions.length === 0
          ? copy.searching
          : status === "done" && suggestions.length === 0
            ? /*
               * "No está en la población" y no "no existe": puede estar en
               * Blizzard y no en nuestra base, que es justo lo que resuelve
               * enviar el formulario.
               */
              copy.noSuggestions
            : undefined
      }
    >
      {suggestions.map((suggestion, index) => {
        const spec = suggestion.specSlug ? parseSpecSlug(suggestion.specSlug) : undefined;

        return (
          <SuggestionOption
            key={`${suggestion.realmSlug}/${suggestion.nameSlug}`}
            listId={listId}
            index={index}
            active={index === active}
            onHover={onHover}
            onPick={() => onPick(suggestion)}
            className={`${OPTION} flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2.5 ${
              dense ? "flex-col" : ""
            }`}
          >
            <span className={`${classColor(spec?.classSlug).text} text-base`}>
              {suggestion.nameDisplay}
            </span>
            <span className="text-muted-foreground text-sm">
              {spec ? `${spec.label} · ${suggestion.realmSlug}` : suggestion.realmSlug}
            </span>
            {/*
             * Sin rating no se escribe un guion ni un cero: el personaje existe
             * y lo que falta es la observación, no el dato.
             */}
            <span className={`text-muted-foreground text-sm ${dense ? "" : "ms-auto"}`}>
              {suggestion.rating === null ? copy.noRating : suggestion.rating}
            </span>
          </SuggestionOption>
        );
      })}
    </SuggestionPanel>
  );
}
