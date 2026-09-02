"use client";

import type { ReactNode } from "react";

import { PopoverContent } from "./ui/popover";

/**
 * El desplegable de los buscadores: la caja, la lista y una opción.
 *
 * Está aquí y no repartido por los dos buscadores porque lo que decide si un
 * combobox es usable no es el aspecto, es esta media docena de detalles de foco
 * y de ARIA; escritos tres veces, se arreglan en uno y siguen mal en los otros
 * dos — que es exactamente lo que pasaba antes del ADR 0025.
 *
 * Sobre `Popover` de Radix y no sobre `Command`: `Command` mueve el foco a su
 * propio campo y hace `preventDefault()` en **todos** los Enter, y este
 * formulario necesita que el Enter sin sugerencia elegida llegue al `<form>` —
 * es el fallback a Blizzard del ADR 0024, la única escritura que tiene la web.
 * De `Popover` se usa lo que sí hace falta y no teníamos: cerrar con Escape,
 * cerrar al pulsar fuera y colocarse solo. Eso es lo que retira el
 * `setTimeout(…, 150)` contra el `blur` con el que se cerraba antes.
 */

/** El `id` de la opción n, que es lo que apunta el `aria-activedescendant`. */
export function optionId(listId: string, index: number): string {
  return `${listId}-option-${index}`;
}

/** Una fila del desplegable. Se comparte para que las dos listas midan igual. */
export const OPTION =
  "border-border flex cursor-pointer border-b px-4 py-2 text-left last:border-b-0 aria-selected:bg-accent";

/**
 * Lo que el desplegable tiene que hacer para no comportarse como un diálogo.
 *
 * El foco **no se mueve**: en un combobox se queda en el campo y lo que viaja
 * es el `aria-activedescendant`. Sin prevenir los dos autofoco, Radix lleva el
 * cursor al panel al abrirlo y lo devuelve al cerrarlo, y por el camino se
 * pierde lo que se estaba tecleando.
 */
const DROPDOWN = {
  align: "start",
  sideOffset: 4,
  onOpenAutoFocus: (event: Event) => event.preventDefault(),
  onCloseAutoFocus: (event: Event) => event.preventDefault(),
} as const;

export function SuggestionPanel({
  listId,
  label,
  note,
  children,
}: {
  listId: string;
  label: string;
  /** Un estado que no es una opción: "buscando…", "no está en la población". */
  note?: string | undefined;
  children: ReactNode;
}) {
  return (
    <PopoverContent
      {...DROPDOWN}
      /*
       * El ancho lo pone el campo al que se ancla y no el de `Popover`: un
       * desplegable más estrecho que su campo se lee como otro control.
       */
      className="border-input w-(--radix-popover-trigger-width) overflow-hidden p-0"
    >
      {/*
       * El aviso va fuera de la lista, no dentro: un `listbox` contiene
       * opciones, y "buscando…" no es una que se pueda elegir.
       */}
      {note !== undefined && <p className="text-subtle-foreground px-4 py-3 text-xs">{note}</p>}

      {/*
       * La lista se pinta también cuando está vacía. Es lo que sostiene el
       * `aria-controls` del campo: un `id` que aparece y desaparece deja al
       * lector de pantalla apuntando a un elemento que no existe.
       */}
      <ul id={listId} role="listbox" aria-label={label} className="flex flex-col">
        {children}
      </ul>
    </PopoverContent>
  );
}

export function SuggestionOption({
  listId,
  index,
  active,
  onHover,
  onPick,
  className,
  children,
}: {
  listId: string;
  index: number;
  active: boolean;
  onHover: (index: number) => void;
  onPick: () => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <li
      id={optionId(listId, index)}
      role="option"
      aria-selected={active}
      onMouseEnter={() => onHover(index)}
      /*
       * `onMouseDown` con `preventDefault` es lo que impide que pulsar una
       * opción le quite el foco al campo. Es la mitad limpia de lo que antes
       * hacía el temporizador de cierre: sin esto, el campo pierde el foco
       * antes de que llegue el `click` y la opción se escapa bajo el cursor.
       */
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPick}
      className={className}
    >
      {children}
    </li>
  );
}
