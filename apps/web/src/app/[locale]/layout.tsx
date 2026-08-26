import type { Metadata } from "next";
import { Cinzel } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SiteFooter, SiteHeader } from "../../components/site-chrome";
import { copyFor } from "../../i18n/copy";
import { LOCALES, SOURCE_LOCALE, isLocale } from "../../i18n/locales";
import { isPublicSite, siteUrl } from "../../site";
import "../globals.css";

// El layout raíz cuelga del segmento de idioma porque el `lang` del <html>
// depende del idioma y no hay ninguna página fuera de él: la raíz sin prefijo
// no llega a renderizarse nunca, la redirige el middleware.

// La tipografía de titular del sistema visual (docs/design/system.md). Se sirve
// desde nuestro dominio, no desde Google: next/font descarga el fichero en
// build y lo empaqueta, así que no hay petición a un tercero desde el navegador
// del jugador ni una fuente que pueda dejar de cargar en tiempo de ejecución.
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
  variable: "--font-cinzel",
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const name = copyFor(isLocale(locale) ? locale : SOURCE_LOCALE).site.name;

  return {
    // Los hreflang de cada página son rutas relativas y se resuelven contra
    // esta, así que de aquí depende que un preview no se anuncie como el
    // dominio de producción.
    metadataBase: siteUrl(process.env),
    // La plantilla se define una vez: si cada página compusiera su propio
    // título, el nombre del producto acabaría escrito de dos formas.
    title: { template: `%s · ${name}`, default: name },
    // Todo lo que no es el sitio público sale del índice. Un preview indexado
    // compite con producción por sus propias URL.
    ...(isPublicSite(process.env) ? {} : { robots: { index: false, follow: false } }),
  };
}

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
    <html lang={locale} className={cinzel.variable}>
      {/*
       * La columna a altura completa mantiene el pie abajo también en las
       * páginas cortas, que hoy son todas: la línea de atribución flotando a
       * media pantalla no se lee como parte del documento.
       */}
      <body className="flex min-h-dvh flex-col">
        <SiteHeader locale={locale} />
        <div className="flex-1">{children}</div>
        <SiteFooter locale={locale} />
      </body>
    </html>
  );
}
