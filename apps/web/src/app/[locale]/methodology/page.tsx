import { METHODOLOGY_PATH, METHODOLOGY_SECTIONS } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "../../../i18n/alternates";
import { formatDate } from "../../../i18n/format";
import { LOCALES, isLocale } from "../../../i18n/locales";
import { METHODOLOGY_UPDATED_AT, methodologyFor } from "../../../i18n/methodology";

// La única página del MVP sin tramos dinámicos, y obligatoria desde el día 1
// (§24): es la que sostiene la promesa de método. Existe en las dos lenguas y
// se genera en build, porque su contenido no depende de ningún dato.
export function generateStaticParams(): { locale: string }[] {
  return LOCALES.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  if (!isLocale(locale)) return {};

  const doc = methodologyFor(locale);
  return {
    title: doc.title,
    description: doc.lead,
    alternates: alternatesFor(METHODOLOGY_PATH, locale),
  };
}

export default async function MethodologyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const doc = methodologyFor(locale);

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-8 px-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-foreground text-2xl">{doc.title}</h1>
        <p className="text-muted-foreground text-base">{doc.lead}</p>
      </header>

      {/* El orden y los `id` los pone el catálogo de rutas, que es lo que
          enlazan las demás páginas: escritos aquí, un enlace al apartado de
          confianza dejaría de aterrizar en él sin que fallara nada. */}
      {METHODOLOGY_SECTIONS.map((id) => {
        const section = doc.sections[id];
        return (
          <section key={id} id={id} className="flex flex-col gap-3">
            {/* `font-display` lo pone la regla base de `globals.css` para h1–h3. */}
            <h2 className="text-foreground text-xl">{section.heading}</h2>
            {section.paragraphs.map((paragraph) => (
              <p key={paragraph} className="text-muted-foreground text-base">
                {paragraph}
              </p>
            ))}
          </section>
        );
      })}

      <p className="text-subtle-foreground text-sm">
        {doc.updated(formatDate(METHODOLOGY_UPDATED_AT, locale))}
      </p>
    </main>
  );
}
