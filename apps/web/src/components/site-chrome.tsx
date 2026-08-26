import { METHODOLOGY_PATH } from "@wowpvp/core";
import Link from "next/link";

import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";
import { LanguageSwitch } from "./language-switch";

/**
 * La cabecera y el pie que rodean a todas las páginas.
 *
 * Se renderizan desde el layout y no página a página porque la línea de
 * atribución tiene que estar en **todas** (brief §4.3, cláusula 2.m de la ToU):
 * repetirla en cada página es garantizar que algún día falte en una.
 */
export function SiteHeader({ locale }: { locale: Locale }) {
  const copy = copyFor(locale);

  return (
    <header className="border-line border-b">
      <div className="mx-auto max-w-measure px-5 py-4">
        {/*
         * `font-display` explícito porque la marca no es un encabezado: la
         * regla base de `globals.css` solo alcanza a h1–h3, y sin esto el
         * nombre saldría en dos tipografías distintas según dónde se lea.
         */}
        <Link
          href={localizedPathname("/", locale)}
          className="text-accent tracking-caps font-display text-lg uppercase"
        >
          {copy.site.name}
        </Link>
      </div>
    </header>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const copy = copyFor(locale);

  return (
    <footer className="border-line mt-12 border-t">
      {/*
       * La navegación va encima de la línea legal, no debajo: un aviso empujado
       * bajo los enlaces se lee como el pie de imprenta que nadie mira, que es
       * justo lo contrario de "conspicuous" (brief §4.3).
       */}
      <div className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-8">
        <nav aria-label={copy.nav.siteLabel} className="flex flex-wrap gap-x-4 gap-y-2 text-xs">
          <Link
            href={localizedPathname(METHODOLOGY_PATH, locale)}
            className="text-ink-secondary hover:text-ink underline"
          >
            {copy.nav.methodology}
          </Link>
          <LanguageSwitch locale={locale} />
        </nav>
        {/*
         * `text-xs` es el suelo del sistema tipográfico, no letra pequeña: por
         * debajo no hay token con el que escribirla (docs/design/system.md).
         */}
        <p className="text-ink-secondary text-xs">{copy.attribution}</p>
      </div>
    </footer>
  );
}
