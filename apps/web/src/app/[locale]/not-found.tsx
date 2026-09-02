"use client";

import { HOME_PATH } from "@wowpvp/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { copyFor } from "../../i18n/copy";
import { SOURCE_LOCALE, localeFromPathname, localizedPathname } from "../../i18n/locales";

/**
 * El 404 de las dos lenguas.
 *
 * Es la única página que no recibe los tramos de su ruta —Next no le pasa
 * `params`—, así que el idioma sale de la dirección que se pidió. Se lee en
 * cliente y no del encabezado de la petición por una razón medible: `headers()`
 * aquí marca como dinámica toda la rama que cuelga del layout, y la portada y la
 * metodología dejan de generarse en build por culpa de la página de error.
 */
export default function NotFound() {
  const locale = localeFromPathname(usePathname()) ?? SOURCE_LOCALE;
  const copy = copyFor(locale).notFound;

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-16">
      <h1 className="text-xl text-foreground">{copy.title}</h1>
      <p className="text-muted-foreground text-base">{copy.body}</p>
      <Link
        href={localizedPathname(HOME_PATH, locale)}
        className="text-primary self-start text-sm underline"
      >
        {copy.back}
      </Link>
    </main>
  );
}
