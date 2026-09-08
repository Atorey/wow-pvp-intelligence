"use client";

import { usePathname } from "next/navigation";

import { copyFor } from "../../i18n/copy";
import { SOURCE_LOCALE, localeFromPathname } from "../../i18n/locales";

/**
 * Lo que se lee cuando el render de una página falla (ADR 0030).
 *
 * Hasta ahora no existía, y eso significaba que un pooler que no responde o una
 * variable de entorno que falta acababan en la pantalla genérica de Next: sin
 * marca, en un solo idioma y con una traza para quien no puede hacer nada con
 * ella.
 *
 * **Un fallo de lectura no se disfraza de dato ausente.** La caja Player Gap
 * tiene tres estados para decir que no hay muestra suficiente y ninguno vale
 * aquí: aquellos hablan de una población que no da, y esto de una consulta que
 * no llegó a hacerse. Confundirlos le echaría al dataset la culpa de una caída.
 *
 * El idioma sale de la ruta, como en el 404 y por el mismo motivo: leerlo del
 * encabezado marcaría como dinámica toda la rama del layout y la portada
 * dejaría de generarse en build.
 *
 * Quien se entera de esto no es el visitante: `onRequestError` ya lo ha escrito
 * en los registros del servidor antes de que este componente se pinte.
 */
export default function ErrorBoundary({ reset }: { error: Error; reset: () => void }) {
  const locale = localeFromPathname(usePathname()) ?? SOURCE_LOCALE;
  const copy = copyFor(locale).error;

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-16">
      <h1 className="text-foreground text-xl">{copy.title}</h1>
      <p className="text-muted-foreground text-base">{copy.body}</p>
      {/*
       * `reset()` y no un enlace de recarga: reintenta el render sin volver a
       * pedir la página entera, que es lo que hace falta cuando lo que falló fue
       * una consulta y no la ruta.
       */}
      <button type="button" onClick={reset} className="text-primary self-start text-sm underline">
        {copy.retry}
      </button>
    </main>
  );
}
