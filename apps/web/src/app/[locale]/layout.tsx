import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { LOCALES, isLocale } from "../../i18n/locales";
import { isPublicSite, siteUrl } from "../../site";
import "../globals.css";

// El layout raíz cuelga del segmento de idioma porque el `lang` del <html>
// depende del idioma y no hay ninguna página fuera de él: la raíz sin prefijo
// no llega a renderizarse nunca, la redirige el middleware.

export const metadata: Metadata = {
  // Los hreflang de cada página son rutas relativas y se resuelven contra
  // esta, así que de aquí depende que un preview no se anuncie como el
  // dominio de producción.
  metadataBase: siteUrl(process.env),
  title: "One Rung",
  // Todo lo que no es el sitio público sale del índice. Un preview indexado
  // compite con producción por sus propias URL.
  ...(isPublicSite(process.env) ? {} : { robots: { index: false, follow: false } }),
};

export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  // Un prefijo que no es ninguno de los dos idiomas es una URL que no existe,
  // no una que se sirve en inglés: servirla duplicaría cada página bajo
  // infinitos prefijos y el ADR 0012 solo contempla dos.
  if (!isLocale(locale)) notFound();

  return (
    <html lang={locale}>
      <body>{children}</body>
    </html>
  );
}
