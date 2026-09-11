import type { AdoptionRead } from "@wowpvp/data";

import { copyFor } from "../i18n/copy";
import { formatCount, formatPercent } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import { ProportionBar } from "./proportion-bar";

/**
 * Las adopciones de una familia en un tramo, de más a menos llevadas.
 *
 * Enseña las primeras `visible` y **pliega** el resto: una fila de 3/312 sigue
 * siendo algo observado, y cortarla decidiría por quien lee qué cuenta. El
 * pliegue es el `<details>` del navegador y no el `Collapsible` de shadcn, cuyo
 * patrón choca con esta página: no pinta lo cerrado en el HTML y necesita
 * JavaScript para abrirse, y aquí lo plegado tiene que estar en la dirección que
 * se indexa y abrirse sin script, como las pestañas del perfil.
 *
 * Cada fila lleva su porcentaje **y su fracción cruda**, nunca el porcentaje
 * solo (§13.5 del plan), con el denominador de la propia variable: es sobre
 * quien de verdad se calculó.
 */
export function AdoptionList({
  locale,
  rows,
  visible,
  fill,
  withIcon,
}: {
  locale: Locale;
  rows: readonly AdoptionRead[];
  visible: number;
  fill: string;
  /** Solo lo que es equipo reserva el hueco del icono; un talento no tiene. */
  withIcon: boolean;
}) {
  const copy = copyFor(locale).spec.segment;
  const shown = rows.slice(0, visible);
  const folded = rows.slice(visible);
  const item = (row: AdoptionRead) => (
    <AdoptionItem key={row.variableKey} locale={locale} row={row} fill={fill} withIcon={withIcon} />
  );

  return (
    <div className="flex flex-col">
      <ul className="flex flex-col">{shown.map(item)}</ul>
      {folded.length > 0 && (
        <details>
          <summary className="text-primary cursor-pointer py-1.5 text-sm underline">
            {copy.more(formatCount(folded.length, locale))}
          </summary>
          <ul className="flex flex-col">{folded.map(item)}</ul>
        </details>
      )}
    </div>
  );
}

/**
 * Una adopción: el hueco del icono si es equipo, el nombre, el porcentaje, la
 * barra y la fracción.
 *
 * **El hueco del icono se reserva siempre** que la fila es de equipo (§4.5 del
 * brief), también en los encantamientos, que casi nunca lo tienen: la fila
 * conserva su forma en vez de recolocarse, porque el nombre es la información y
 * el icono solo acompaña.
 */
function AdoptionItem({
  locale,
  row,
  fill,
  withIcon,
}: {
  locale: Locale;
  row: AdoptionRead;
  fill: string;
  withIcon: boolean;
}) {
  const fraction = `${formatCount(row.users, locale)}/${formatCount(row.provenance.denominator, locale)}`;

  return (
    <li className="flex items-center gap-3 py-1.5">
      {withIcon && (
        <span className="bg-secondary border-border flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-md border">
          {row.iconUrl !== null && (
            /*
             * `img` y no `next/image`: optimizar la imagen es servirla desde
             * nuestro dominio, y eso es "making publicly available" el Material
             * de Blizzard (ADR 0015). Sin `alt` porque el nombre está escrito
             * al lado.
             */
            <img src={row.iconUrl} alt="" width={32} height={32} loading="lazy" />
          )}
        </span>
      )}
      <div className="flex min-w-0 grow flex-col gap-1">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-foreground min-w-0 text-sm">{labelOf(row)}</span>
          <span className="text-foreground font-display shrink-0 text-base">
            {formatPercent(row.rate, locale)}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <ProportionBar value={row.rate} fill={fill} />
          <span className="text-subtle-foreground shrink-0 text-xs">{fraction}</span>
        </div>
      </div>
    </li>
  );
}

/**
 * Cómo se nombra una variable. Cuando el nombre no está se escribe el id:
 * `null` es "no disponible" (regla 5), y una fila sin nombre sigue siendo una
 * adopción observada que no puede desaparecer de la lista.
 */
function labelOf(row: AdoptionRead): string {
  switch (row.kind) {
    case "gear-enchant":
      return row.enchantmentName ?? `#${row.enchantmentId}`;
    case "talent-node":
    case "pvp-talent":
    case "hero-tree":
      return row.talentName ?? `#${row.talentId}`;
    default:
      return row.itemName ?? `#${row.itemId}`;
  }
}
