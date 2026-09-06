import { PRIVACY_PATH } from "@wowpvp/core";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { alternatesFor } from "../../../i18n/alternates";
import { formatDate } from "../../../i18n/format";
import { LEGAL_UPDATED_AT, legalFor } from "../../../i18n/legal";
import { LOCALES, isLocale } from "../../../i18n/locales";
import { isPublicSite, privacyContact } from "../../../site";

/*
 * La política de privacidad (ADR 0028).
 *
 * No es una página que el producto elija tener: la 2.p de la ToU de Blizzard
 * obliga a publicarla y le condiciona el contenido (ADR 0015, decisión 9). El
 * ADR 0020 la había declarado sin código porque no había nada que decir en
 * ella; ahora sí lo hay.
 *
 * Se genera en build en las dos lenguas, como la de metodología: su contenido
 * no depende de ningún dato.
 */
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

  const legal = legalFor(locale);
  return {
    title: legal.title,
    description: legal.lead,
    alternates: alternatesFor(PRIVACY_PATH, locale),
  };
}

export default async function PrivacyPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();

  const legal = legalFor(locale);
  const contact = privacyContact(process.env);

  /*
   * Publicar la política sin la dirección a la que dirigir una solicitud de
   * derechos es incumplir en silencio, así que en producción no se sirve: falla
   * como falla `getDatabaseUrl()` cuando le falta la cadena. En local y en
   * preview se renderiza sin esa línea, que es donde el sitio está hoy.
   */
  if (contact === null && isPublicSite(process.env)) {
    throw new Error(
      "Falta PRIVACY_CONTACT. La política de privacidad no puede publicarse sin la dirección " +
        "a la que se dirigen las solicitudes de derechos (ADR 0028).",
    );
  }

  const sections = [legal.site, legal.character, legal.measurement, legal.storage] as const;

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-8 px-5 py-8">
      <header className="flex flex-col gap-2">
        <h1 className="text-foreground text-2xl">{legal.title}</h1>
        <p className="text-muted-foreground text-base">{legal.lead}</p>
      </header>

      {sections.map((section) => (
        <Section key={section.heading} heading={section.heading} paragraphs={section.paragraphs} />
      ))}

      <Section heading={legal.thirdParties.heading} paragraphs={legal.thirdParties.paragraphs} />

      <Section heading={legal.rights.heading} paragraphs={legal.rights.paragraphs}>
        <p className="text-foreground text-base">
          {contact === null ? legal.rights.contactPending : legal.rights.contact(contact)}
        </p>
      </Section>

      <Section heading={legal.changes.heading} paragraphs={legal.changes.paragraphs}>
        {/* La fecha se guarda una vez en ISO y la formatea cada lengua: escrita
            dos veces, una política se acaba fechando distinto en cada idioma. */}
        <p className="text-subtle-foreground text-sm">
          {legal.changes.updated(formatDate(LEGAL_UPDATED_AT, locale))}
        </p>
      </Section>
    </main>
  );
}

function Section({
  heading,
  paragraphs,
  children,
}: {
  heading: string;
  paragraphs: readonly string[];
  children?: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      {/* `font-display` lo pone la regla base de `globals.css` para h1–h3. */}
      <h2 className="text-foreground text-xl">{heading}</h2>
      {paragraphs.map((paragraph) => (
        <p key={paragraph} className="text-muted-foreground text-base">
          {paragraph}
        </p>
      ))}
      {children}
    </section>
  );
}
