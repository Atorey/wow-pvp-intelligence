import Link from "next/link";
import type { ReactNode } from "react";

import { copyFor } from "../i18n/copy";
import { type Locale, localizedPathname } from "../i18n/locales";

export interface Crumb {
  /** Ruta sin prefijo de locale, tal como la construye `@wowpvp/core`. */
  path: string;
  label: string;
}

/**
 * Una página que ya existe como dirección y todavía no tiene contenido.
 *
 * Enseña lo que se deduce de la propia URL —la spec, el bracket, el segmento, el
 * personaje— y nada más. Rellenarla con cifras de ejemplo mientras se maqueta
 * sería inventar el dato que este producto vende, así que aquí no hay ni
 * marcadores numéricos ni barras de relleno.
 */
export function PagePlaceholder({
  locale,
  title,
  lead,
  trail = [],
  children,
}: {
  locale: Locale;
  title: string;
  lead: string;
  /** Los niveles superiores de la jerarquía, del más general al más concreto. */
  trail?: readonly Crumb[];
  children?: ReactNode;
}) {
  const copy = copyFor(locale);

  return (
    <main className="mx-auto flex max-w-measure flex-col gap-4 px-5 py-8">
      {trail.length > 0 && (
        <nav
          aria-label={copy.nav.trailLabel}
          className="text-ink-secondary flex flex-wrap items-center gap-x-2 text-xs"
        >
          {trail.map((crumb, index) => (
            <span key={crumb.path} className="flex items-center gap-x-2">
              {index > 0 && <span aria-hidden="true">/</span>}
              <Link
                href={localizedPathname(crumb.path, locale)}
                className="hover:text-ink underline"
              >
                {crumb.label}
              </Link>
            </span>
          ))}
        </nav>
      )}

      <h1 className="text-2xl text-ink">{title}</h1>
      <p className="text-ink-secondary text-base">{lead}</p>
      {children}
      <p className="text-ink-muted text-xs">{copy.placeholder.note}</p>
    </main>
  );
}
