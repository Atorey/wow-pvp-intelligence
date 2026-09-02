"use client";

import { ThemeProvider as NextThemes } from "next-themes";
import type { ReactNode } from "react";

/**
 * Quién decide el tema (ADR 0025, decisión 5).
 *
 * Lo que aporta `next-themes` y no se puede escribir en tres líneas es el
 * script que corre **antes de la primera pintura**: sin él la página se pinta
 * con el tema de por defecto y salta al elegido en cuanto hidrata, que es el
 * parpadeo blanco que nadie perdona en un sitio oscuro.
 *
 * `defaultTheme="system"` y no `"dark"` porque el oscuro ya es lo que hay en
 * `:root`: quien no ha elegido nada y no expresa preferencia lo recibe igual,
 * sin clase y sin JavaScript. Lo que este proveedor añade encima es respetar la
 * preferencia del sistema y, sobre todo, poder llevarle la contraria.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  return (
    <NextThemes
      attribute="class"
      defaultTheme="system"
      enableSystem
      /*
       * Sin esto, cambiar de tema anima cada color que tenga una transición
       * declarada y la pantalla entera se funde durante medio segundo. El
       * cambio de tema no es un movimiento de interfaz: es la misma pantalla
       * pintada de otro color.
       */
      disableTransitionOnChange
    >
      {children}
    </NextThemes>
  );
}
