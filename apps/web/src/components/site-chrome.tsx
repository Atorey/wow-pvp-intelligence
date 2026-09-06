import { getRegion } from "@wowpvp/blizzard";
import {
  BRACKET_LABELS,
  CLASS_LABELS,
  CLASS_SLUGS,
  HOME_PATH,
  METHODOLOGY_PATH,
  PRIVACY_PATH,
} from "@wowpvp/core";
import Link from "next/link";
import type { ReactNode } from "react";

import { classColor } from "../design/class-color";
import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";
import { LanguageSwitch } from "./language-switch";
import { MobileMenu } from "./mobile-menu";
import { QuickSearch } from "./quick-search";
import { ThemeSwitch } from "./theme-switch";
import { BookOpen, ShieldCheck } from "lucide-react";

/**
 * El armazón que rodea a todas las páginas: barra lateral y pie.
 *
 * Se renderizan desde el layout y no página a página porque la línea de
 * atribución tiene que estar en **todas** (brief §4.3, cláusula 2.m de la ToU):
 * repetirla en cada página es garantizar que algún día falte en una.
 */

/**
 * Las modalidades que el jugador conoce, en el orden en que las nombra.
 *
 * Solo la primera está publicada. Las otras cuatro **no son páginas que falten**:
 * el pipeline no ingiere sus leaderboards, así que de ellas no hay dato ninguno.
 * Están escritas aquí y no en `packages/core` justo por eso — no son rutas ni
 * conceptos del dominio, son los nombres del juego.
 */
const BRACKETS = [BRACKET_LABELS["solo-shuffle"], "2v2", "3v3", "RBG", "BG Blitz"] as const;

/**
 * Un bloque de la barra lateral: etiqueta en versalita y lista.
 *
 * Varias de sus entradas todavía no llevan a ninguna parte. No se pintan
 * apagadas —el sistema visual no tiene nivel "deshabilitado"
 * (docs/design/system.md §2.1)—: la que está publicada se marca como actual y
 * las demás son texto del mismo nivel, sin insinuar nada.
 */
function SidebarBlock({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <p className="text-subtle-foreground tracking-caps font-display px-3 pb-1 text-xs uppercase">
        {label}
      </p>
      <ul className="flex flex-col">{children}</ul>
    </div>
  );
}

const ROW = "flex items-center gap-2.5 rounded px-3 py-1.5 text-sm";

export function SiteSidebar({ locale }: { locale: Locale }) {
  const copy = copyFor(locale);
  const region = getRegion();

  /*
   * El contenido del panel se escribe una vez y se pinta en dos sitios: dentro
   * del `Sheet` en estrecho y en la columna en ancho. Es la misma decisión que
   * antes del ADR 0025 —un marcado y no dos, que divergen en cuanto se toca uno
   * de los dos—, solo que ahora la copia la hace React en vez de CSS.
   *
   * Nunca están los dos a la vez en el documento: el `Sheet` no monta su
   * contenido hasta que se abre, y la columna se oculta por debajo de `lg`.
   */
  const panel = (
    <>
      <QuickSearch locale={locale} region={region} />

      <SidebarBlock label={copy.nav.bracketsLabel}>
        {BRACKETS.map((bracket, index) => (
          <li key={bracket}>
            {/*
             * Solo Shuffle es la única publicada, y es además donde ya está
             * el visitante: se marca como actual en vez de enlazar a la
             * página en la que ya se encuentra el sitio entero.
             */}
            <span
              aria-current={index === 0 ? "true" : undefined}
              className={`${ROW} ${index === 0 ? "bg-accent text-accent-foreground" : "text-muted-foreground"}`}
            >
              {bracket}
            </span>
          </li>
        ))}
      </SidebarBlock>

      <SidebarBlock label={copy.nav.classesLabel}>
        {CLASS_SLUGS.map((slug) => (
          <li key={slug}>
            <span className={`${ROW} text-muted-foreground`}>
              {/*
               * El punto lleva el color de clase y el nombre está escrito al
               * lado: el color acompaña, nunca es lo único que distingue una
               * entrada de otra.
               */}
              <span
                aria-hidden="true"
                className={`${classColor(slug).fill} size-2.5 shrink-0 rounded-sm`}
              />
              {CLASS_LABELS[slug]}
            </span>
          </li>
        ))}
      </SidebarBlock>
    </>
  );

  return (
    <aside className="border-border bg-card flex shrink-0 flex-col gap-5 border-b p-4 lg:sticky lg:top-0 lg:h-dvh lg:w-sidebar lg:overflow-y-auto lg:border-r lg:border-b-0 lg:px-3 lg:py-5">
      <div className="flex items-center justify-between gap-4">
        {/*
         * `font-brand` explícito porque la marca no es un encabezado: la regla
         * base de `globals.css` solo alcanza a h1–h3 y les pone la tipografía
         * de titular, que no es la de la marca.
         */}
        <Link
          href={localizedPathname(HOME_PATH, locale)}
          className="text-primary tracking-caps font-brand px-3 text-lg uppercase"
        >
          {copy.site.name}
        </Link>

        <MobileMenu label={copy.nav.menuLabel}>{panel}</MobileMenu>
      </div>

      <div className="hidden flex-col gap-5 lg:flex">{panel}</div>
    </aside>
  );
}

export function SiteFooter({ locale }: { locale: Locale }) {
  const copy = copyFor(locale);

  return (
    <footer className="border-border mt-12 border-t">
      {/*
       * La navegación va encima de la línea legal, no debajo: un aviso empujado
       * bajo los enlaces se lee como el pie de imprenta que nadie mira, que es
       * justo lo contrario de "conspicuous" (brief §4.3).
       */}
      <div className="mx-auto flex max-w-page flex-col gap-4 px-5 py-8 lg:px-8">
        <nav
          aria-label={copy.nav.footerLabel}
          className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs"
        >
          <Link
            href={localizedPathname(METHODOLOGY_PATH, locale)}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <BookOpen className="size-4" aria-hidden="true" />
            <span>{copy.nav.methodology}</span>
          </Link>
          {/*
           * La política de privacidad no es un enlace de cortesía: la 2.p de la
           * ToU obliga a publicarla (ADR 0015, decisión 9) y el ADR 0020 dejó
           * dicho que no se enlazaría mientras no existiera. Ya existe.
           */}
          <Link
            href={localizedPathname(PRIVACY_PATH, locale)}
            className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <ShieldCheck className="size-4" aria-hidden="true" />
            <span>{copy.nav.privacy}</span>
          </Link>
          <LanguageSwitch locale={locale} />
          <ThemeSwitch locale={locale} />
        </nav>
        {/*
         * `text-xs` es el suelo del sistema tipográfico, no letra pequeña: por
         * debajo no hay token con el que escribirla (docs/design/system.md).
         */}
        <p className="text-muted-foreground text-xs">{copy.attribution}</p>
      </div>
    </footer>
  );
}
