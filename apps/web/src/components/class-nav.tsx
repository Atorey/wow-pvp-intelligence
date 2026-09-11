"use client";

import { ALL_SPECS, CLASS_LABELS, CLASS_SLUGS, type ClassSlug, specPath } from "@wowpvp/core";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { classColor } from "../design/class-color";
import { type Locale, localizedPathname } from "../i18n/locales";
import { SIDEBAR_ROW } from "./sidebar-row";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "./ui/collapsible";

/**
 * "Frost" de "Frost Mage": dentro de la clase, repetirla en cada spec es ruido.
 *
 * Se recorta del `label` y no se construye del `specSlug` porque el slug no es
 * cómo se escribe ("beast-mastery"). Que todo `label` acabe en el nombre de su
 * clase lo comprueban los tests del catálogo en `packages/core`.
 */
function specName(label: string, classSlug: ClassSlug): string {
  const suffix = ` ${CLASS_LABELS[classSlug]}`;
  return label.endsWith(suffix) ? label.slice(0, -suffix.length) : label;
}

/**
 * Las trece clases de la barra lateral, cada una desplegando sus specs.
 *
 * La clase no enlaza a ninguna parte porque no tiene página: el mapa de rutas
 * empieza en la spec (ADR 0020, decisión 1). Por eso es un desplegable y no un
 * enlace, y lo que lleva a `/spec/…` son sus specs.
 *
 * Es de cliente porque tiene que saber en qué página está el visitante, y el
 * layout que la pinta no lo sabe: se renderiza una vez y sobrevive a la
 * navegación. Con `usePathname` abre la clase de la spec actual y la marca.
 */
export function ClassNav({ locale }: { locale: Locale }) {
  const pathname = usePathname();

  return CLASS_SLUGS.map((classSlug) => {
    const specs = ALL_SPECS.filter((spec) => spec.classSlug === classSlug).map((spec) => {
      const href = localizedPathname(specPath(spec), locale);
      return {
        spec,
        href,
        exact: pathname === href,
        // Dentro de la spec también es "aquí": la modalidad y el tramo cuelgan
        // de ella, y la barra no tiene una entrada más concreta que marcar.
        within: pathname === href || pathname.startsWith(`${href}/`),
      };
    });

    return (
      <li key={classSlug}>
        <Collapsible defaultOpen={specs.some((entry) => entry.within)}>
          <CollapsibleTrigger
            className={`${SIDEBAR_ROW} group text-muted-foreground hover:text-foreground w-full cursor-pointer text-left transition-colors`}
          >
            {/*
             * El punto lleva el color de clase y el nombre está escrito al
             * lado: el color acompaña, nunca es lo único que distingue una
             * entrada de otra.
             */}
            <span
              aria-hidden="true"
              className={`${classColor(classSlug).fill} size-2.5 shrink-0 rounded-sm`}
            />
            <span className="flex-1">{CLASS_LABELS[classSlug]}</span>
            <ChevronRight
              aria-hidden="true"
              className="size-4 shrink-0 transition-transform group-data-[state=open]:rotate-90"
            />
          </CollapsibleTrigger>

          {/*
           * `forceMount` deja los enlaces en el HTML aunque la clase esté
           * plegada: sin él, las specs de las clases cerradas no existirían para
           * quien rastrea el sitio, y la barra es el único camino interno a la
           * mayoría de `/spec/…`. El precio es que Radix deja de poner `hidden`
           * —con el contenido forzado lo da siempre por presente—, así que el
           * plegado lo hace la clase sobre `data-state`.
           */}
          <CollapsibleContent forceMount className="data-[state=closed]:hidden">
            <ul className="border-border ml-4 flex flex-col border-l py-1 pl-2">
              {specs.map(({ spec, href, exact, within }) => (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={exact ? "page" : within ? "true" : undefined}
                    className={`${SIDEBAR_ROW} ${
                      within
                        ? "bg-accent text-accent-foreground"
                        : "text-muted-foreground hover:text-foreground transition-colors"
                    }`}
                  >
                    {specName(spec.label, classSlug)}
                  </Link>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      </li>
    );
  });
}
