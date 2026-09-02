"use client";

import { foldSlug, realmSlug } from "@wowpvp/core";
import type { CharacterSuggestion } from "@wowpvp/data";
import { useEffect, useState, type KeyboardEvent } from "react";

/**
 * Las sugerencias mientras se teclea, compartidas por los dos buscadores: el de
 * la portada, que tiene reino y nombre, y el de la barra lateral, que solo tiene
 * nombre.
 *
 * Está extraído en un hook y no copiado en los dos porque lo delicado no es
 * pedir la lista: es cancelar la petición anterior y no dejar que una respuesta
 * lenta pise a una rápida. Duplicado, eso se arregla una vez y sigue roto en el
 * otro sitio.
 *
 * Lo que añade es una comodidad, nunca la feature: los dos buscadores son
 * `<form>` de verdad y funcionan con el script caído.
 */

/** Espera antes de preguntar. Menos convierte cada tecla en una consulta. */
const DEBOUNCE_MS = 200;

/** Lo mismo que exige `searchCharacters`: por debajo el prefijo casa con miles. */
export const MIN_SUGGESTION_LENGTH = 3;

export type SuggestionStatus = "idle" | "loading" | "done";

export interface Suggestions {
  readonly suggestions: CharacterSuggestion[];
  readonly status: SuggestionStatus;
  /** Si procede enseñar la lista, con lo que sea que haya dentro. */
  readonly open: boolean;
}

export function useSuggestions(name: string, realm = ""): Suggestions {
  const [suggestions, setSuggestions] = useState<CharacterSuggestion[]>([]);
  const [status, setStatus] = useState<SuggestionStatus>("idle");

  useEffect(() => {
    if (name.trim().length < MIN_SUGGESTION_LENGTH) {
      setSuggestions([]);
      setStatus("idle");
      return;
    }

    // Cada tecla cancela la petición anterior: sin esto, dos respuestas lentas
    // pueden llegar en orden inverso y la lista acabaría enseñando el prefijo
    // que ya no está escrito.
    const controller = new AbortController();
    setStatus("loading");

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: name.trim() });
      if (realm.trim()) params.set("realm", realm.trim());

      fetch(`/api/search?${params.toString()}`, { signal: controller.signal })
        .then((response) => (response.ok ? response.json() : { suggestions: [] }))
        .then((body: { suggestions?: CharacterSuggestion[] }) => {
          setSuggestions(body.suggestions ?? []);
          setStatus("done");
        })
        .catch(() => {
          // Una petición abortada no es un fallo que enseñar: la siguiente ya
          // viene en camino. Que quede la lista anterior es mejor que un
          // parpadeo a vacío en cada pulsación.
          if (!controller.signal.aborted) setStatus("done");
        });
    }, DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [name, realm]);

  return {
    suggestions,
    status,
    open: status !== "idle" && name.trim().length >= MIN_SUGGESTION_LENGTH,
  };
}

export interface SuggestionNavigation {
  /** Índice resaltado, o -1 si ninguno. */
  readonly active: number;
  readonly setActive: (index: number) => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * El teclado sobre la lista de sugerencias: flechas, Enter y Escape.
 *
 * Enter sobre una sugerencia elegida **no** envía el formulario, y esa es la
 * razón de que exista: con la identidad canónica delante no hay nada que
 * resolver ni cuota de Blizzard que gastar.
 *
 * Y esa es también la razón de que siga siendo nuestro después del ADR 0025,
 * cuando el resto del desplegable pasó a `Popover`. La alternativa era el
 * `Command` de shadcn, y su motor hace dos cosas incompatibles con esto:
 * `preventDefault()` en **todos** los Enter —lo que dejaría el `<form>` sin
 * enviarse nunca, y con él el fallback a Blizzard del ADR 0024— y resaltar la
 * primera opción en cuanto la lista aparece, con lo que un Enter llevaría al
 * primer homónimo en vez de preguntar por el personaje tecleado. Que aquí no
 * haya resaltado hasta que alguien pulsa una flecha no es un descuido: es la
 * diferencia entre elegir una sugerencia y no haber elegido ninguna.
 */
export function useSuggestionNavigation<T>(
  suggestions: readonly T[],
  onPick: (suggestion: T) => void,
): SuggestionNavigation {
  const [active, setActive] = useState(-1);

  // Una lista nueva invalida el resaltado: el índice 2 de la lista anterior es
  // otro personaje en la siguiente, y pulsar Enter llevaría al equivocado.
  useEffect(() => {
    setActive(-1);
  }, [suggestions]);

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (suggestions.length === 0) return;

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      const next = active + step;
      if (next < 0) setActive(suggestions.length - 1);
      else if (next >= suggestions.length) setActive(0);
      else setActive(next);
      return;
    }

    if (event.key === "Enter" && active >= 0) {
      const chosen = suggestions[active];
      if (chosen) {
        event.preventDefault();
        onPick(chosen);
      }
      return;
    }

    if (event.key === "Escape") setActive(-1);
  }

  return { active, setActive, onKeyDown };
}

/**
 * Los reinos que conocemos, traídos una sola vez.
 *
 * No se pide al enfocar ni al teclear: se pide al montar y se guarda. La lista
 * son unos cientos de slugs y la respuesta se cachea una hora, así que traerla
 * entera una vez cuesta menos que una petición por letra — y filtrar sin salir
 * del navegador no tiene latencia que disimular.
 *
 * Un fallo devuelve la lista vacía y no se avisa de nada: el campo de reino
 * admite texto libre igualmente, porque la lista **no es exhaustiva** (sale de
 * nuestra población, no del catálogo de Blizzard). Sin sugerencias el buscador
 * sigue funcionando exactamente igual.
 */
export function useKnownRealms(): string[] {
  const [realms, setRealms] = useState<string[]>([]);

  useEffect(() => {
    const controller = new AbortController();

    fetch("/api/realms", { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : { realms: [] }))
      .then((body: { realms?: string[] }) => setRealms(body.realms ?? []))
      .catch(() => setRealms([]));

    return () => controller.abort();
  }, []);

  return realms;
}

/** Cuántos reinos se enseñan a la vez. Más no caben sin convertir la lista en scroll. */
const REALM_SUGGESTIONS = 8;

/**
 * Los reinos que casan con lo tecleado. Devuelve siempre la forma **canónica**,
 * que es la que la API de Blizzard acepta (ADR 0017).
 *
 * Tres decisiones, y las tres vienen de cómo se escriben los reinos de verdad:
 *
 * - Se compara **plegado**, sin acentos. Quien busca "Confrerie du Thorium" no
 *   teclea `confrérie-du-thorium`, y sin plegar no encontraría su propio reino.
 *   El plegado es solo para buscar; lo que se devuelve y se envía es la forma
 *   con los diacríticos intactos.
 * - Se pasa lo tecleado por `realmSlug()` antes de comparar, para que el espacio
 *   de "Twisting Nether" case con el guion de `twisting-nether`.
 * - Casa por `includes` y no solo por prefijo, porque el slug lleva el nombre
 *   entero: quien recuerda "thorium" no empieza por ahí. Los que empiezan por
 *   lo tecleado salen primero, que es lo que casi siempre se busca.
 */
export function filterRealms(realms: readonly string[], query: string): string[] {
  const needle = foldSlug(realmSlug(query));
  if (!needle) return realms.slice(0, REALM_SUGGESTIONS);

  const starts: string[] = [];
  const contains: string[] = [];
  for (const realm of realms) {
    const folded = foldSlug(realm);
    if (folded.startsWith(needle)) starts.push(realm);
    else if (folded.includes(needle)) contains.push(realm);
  }

  return [...starts, ...contains].slice(0, REALM_SUGGESTIONS);
}
