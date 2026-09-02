"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Globe2 } from "lucide-react";

import { copyFor } from "../i18n/copy";
import { LOCALES, type Locale, localizedPathname } from "../i18n/locales";

/**
 * El conmutador de idioma, que el ADR 0012 exige visible y persistente.
 *
 * Es lo único de cliente del sitio, y por una razón concreta: cambiar de lengua
 * tiene que dejarte en **la misma página**, no en la portada, y la ruta actual
 * solo la conoce el navegador. Mandar a la portada a quien está leyendo un
 * segmento le cuesta volver a encontrarlo.
 */
export function LanguageSwitch({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  const other = LOCALES.find((candidate) => candidate !== locale) ?? locale;

  return (
    <Link
      href={localizedPathname(pathname, other)}
      hrefLang={other}
      lang={other}
      className="inline-flex items-center gap-1.5 text-muted-foreground transition-colors hover:text-foreground"
    >
      <Globe2 className="size-4" aria-hidden="true" />
      <span>{copyFor(locale).site.switchLanguage}</span>
    </Link>
  );
}
