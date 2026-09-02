"use client";

import { Menu } from "lucide-react";
import type { ReactNode } from "react";

import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "./ui/sheet";

/**
 * El menú de pantalla estrecha.
 *
 * Antes del ADR 0025 esto era un `<input type="checkbox">` oculto con un
 * `peer-checked:` detrás, y tenía una virtud que este no tiene: funcionaba sin
 * JavaScript. A cambio no cerraba con Escape, no atrapaba el foco dentro del
 * panel y no bloqueaba el desplazamiento de lo que había debajo, así que quien
 * navegaba con teclado o con lector salía del panel sin haberlo cerrado y
 * seguía tabulando por una página que estaba tapada.
 *
 * El intercambio se decidió a sabiendas y **no alcanza al buscador**: el de la
 * portada sigue siendo un `<form>` que envía sin script (ADR 0024). Lo que se
 * pierde aquí es llegar al menú con el script caído; lo que no se pierde es
 * buscar, que es lo único que escribe.
 *
 * El panel recibe su contenido como `children` y no lo construye: quien lo
 * arma es la barra lateral, en el servidor, y lo pinta en los dos sitios desde
 * el mismo sitio del código para que no puedan divergir.
 */
export function MobileMenu({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Sheet>
      <SheetTrigger
        aria-label={label}
        className="text-muted-foreground hover:text-foreground -m-2 cursor-pointer p-2 lg:hidden"
      >
        <Menu aria-hidden="true" className="size-5" />
      </SheetTrigger>

      <SheetContent
        side="left"
        className="w-[min(20rem,85vw)] gap-5 overflow-y-auto p-4"
        aria-describedby={undefined}
      >
        {/*
         * El panel necesita un nombre accesible y no tiene titular visible: la
         * barra ya se presenta con la marca, y un "Menú" escrito encima de una
         * lista de modalidades sería una etiqueta redundante para quien la ve y
         * el único nombre para quien no.
         */}
        <SheetTitle className="sr-only">{label}</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
