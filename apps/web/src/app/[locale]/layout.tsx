import type { Metadata } from "next";
import { Cinzel, Oswald, Roboto } from "next/font/google";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";

import { SiteFooter, SiteSidebar } from "../../components/site-chrome";
import { ThemeProvider } from "../../components/theme-provider";
import { copyFor } from "../../i18n/copy";
import { LOCALES, SOURCE_LOCALE, isLocale } from "../../i18n/locales";
import { isPublicSite, siteUrl } from "../../site";
import "../globals.css";

// El layout raíz cuelga del segmento de idioma porque el `lang` del <html>
// depende del idioma y no hay ninguna página fuera de él: la raíz sin prefijo
// no llega a renderizarse nunca, la redirige el middleware.

// Las tres tipografías del sistema visual (docs/design/system.md). Las tres se
// sirven desde nuestro dominio, no desde Google: next/font descarga el fichero
// en build y lo empaqueta, así que no hay petición a un tercero desde el
// navegador del jugador ni una fuente que pueda dejar de cargar en ejecución.
//
// Cada una carga los pesos que usa y ni uno más. Un peso de más son decenas de
// kilobytes en la primera pintura de la portada, que es la página que alguien
// abre sin haber decidido todavía si se queda.

/** Solo el nombre del producto. Ver `--font-brand` en `globals.css`. */
const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["600"],
  display: "swap",
  variable: "--font-cinzel",
});

/** Los titulares y las etiquetas en versalita. */
const oswald = Oswald({
  subsets: ["latin"],
  weight: ["500"],
  display: "swap",
  variable: "--font-oswald",
});

/** El texto corrido y las cifras. */
const roboto = Roboto({
  subsets: ["latin"],
  weight: ["400", "500", "700"],
  display: "swap",
  variable: "--font-roboto",
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
    /*
     * `suppressHydrationWarning` va aquí y solo aquí: el script de `next-themes`
     * escribe la clase del tema en este mismo elemento antes de que React
     * hidrate, así que el `<html>` que el servidor mandó y el que el navegador
     * tiene delante nunca coinciden. Es la única diferencia esperada del
     * documento, y silenciarla en la raíz no silencia ninguna otra.
     */
    <html
      lang={locale}
      suppressHydrationWarning
      className={`${cinzel.variable} ${oswald.variable} ${roboto.variable}`}
    >
      {/*
       * El armazón: barra lateral y columna de contenido. En móvil no hay dos
       * columnas —la lateral se convierte en una barra superior, ver
       * `SiteSidebar`—, así que esto es una columna que se parte en fila a
       * partir de `lg` y no una rejilla con un hueco vacío debajo.
       */}
      <body className="flex min-h-dvh flex-col lg:flex-row">
        <ThemeProvider>
          <SiteSidebar locale={locale} />
          {/*
           * `min-w-0` no es defensivo: sin él, una tabla ancha dentro de un hijo
           * de flex ensancha la columna en vez de desplazarse, y arrastra la
           * página entera hacia la derecha.
           *
           * La columna a altura completa mantiene el pie abajo también en las
           * páginas cortas, que hoy son casi todas: la línea de atribución
           * flotando a media pantalla no se lee como parte del documento.
           */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex-1">{children}</div>
            <SiteFooter locale={locale} />
          </div>
        </ThemeProvider>
      </body>
    </html>
  );
}
