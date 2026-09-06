import { slotGroup, type TalentTree } from "@wowpvp/core";

import { copyFor } from "../i18n/copy";
import { formatCount, formatPercent } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import type { DifferenceView } from "../server/player-profile";

/**
 * Una fila de la lista de mayores diferencias (§1.3 del brief, punto 4).
 *
 * Cumple el formato fijo de §13.6 como contrato de datos: la variable, la
 * adopción de arriba y la de tu tramo, **cada una con su fracción cruda**. Lo
 * que no se repite en cada fila —spec, bracket y `n`— está declarado una vez en
 * la cabecera de la caja y siempre visible dentro del mismo bloque; repetirlo
 * cinco veces no añadiría honestidad, añadiría ruido.
 *
 * **El hueco del icono se reserva siempre** (§4.5): el PNG vive en un servidor
 * de Blizzard y no se re-aloja (decisión 7 del ADR 0015), así que puede no haber
 * URL o puede dejar de responder. En los dos casos la fila conserva su forma.
 *
 * Lo que la fila **no** hace: ni barra, ni medidor, ni flecha de subida. El
 * delta ya está en el orden de la lista, y dibujarlo convertiría una diferencia
 * de adopción en un marcador de progreso (§1.4).
 */
export function DifferenceRow({
  locale,
  position,
  difference,
}: {
  locale: Locale;
  /** El puesto en la lista. Se escribe porque el orden es información: manda |Δ|. */
  position: number;
  difference: DifferenceView;
}) {
  const copy = copyFor(locale).player.gap;
  const percent = (value: number): string => formatPercent(value, locale);
  const count = (value: number): string => formatCount(value, locale);

  return (
    <li className="border-border flex gap-3 border-b py-3 last:border-b-0">
      <span className="text-subtle-foreground w-4 shrink-0 pt-2 text-sm">{position}</span>
      <span className="bg-secondary border-border flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border">
        {difference.iconUrl !== null && (
          /*
           * `img` y no `next/image`, igual que en la lista de equipo: optimizar
           * la imagen es servirla desde nuestro dominio, y eso es "making
           * publicly available" el Material de Blizzard (ADR 0015). Sin `alt`
           * porque el nombre está escrito al lado.
           */
          <img src={difference.iconUrl} alt="" width={40} height={40} loading="lazy" />
        )}
      </span>
      <div className="flex min-w-0 grow flex-col gap-0.5">
        <p className="text-foreground text-base">{labelOf(locale, difference)}</p>
        <p className="text-foreground text-sm">
          {copy.list.targetShare(
            percent(difference.target.value),
            count(difference.target.users),
            count(difference.target.denominator),
          )}
        </p>
        <p className="text-muted-foreground text-sm">
          {copy.list.ownShare(
            percent(difference.own.value),
            count(difference.own.users),
            count(difference.own.denominator),
          )}
        </p>
        {difference.playerHasIt && (
          // Contexto, no juicio: dice dónde cae quien mira dentro de la
          // comparación, y por eso no lleva color de acierto ni de error.
          <p className="text-subtle-foreground text-sm">{copy.list.youHaveIt}</p>
        )}
      </div>
    </li>
  );
}

/**
 * Cómo se nombra una variable en su fila.
 *
 * Cada familia se nombra por lo que la identifica —el item por su hueco, la
 * gema y el encantamiento por lo que son, el nodo por su árbol— porque sin eso
 * dos filas distintas se leerían como la misma cosa. Y cuando el nombre no está
 * se escribe el id: `null` es "no disponible" (regla 5), y una fila sin nombre
 * sigue siendo una diferencia observada que no puede desaparecer de la lista.
 */
function labelOf(locale: Locale, { variable }: DifferenceView): string {
  const copy = copyFor(locale).player.gap;
  const slots: Record<string, string> = groupLabels(copyFor(locale).player.gear.slots);

  switch (variable.kind) {
    case "gear-gem":
      return `${variable.itemName ?? `#${variable.itemId}`} · ${copy.kinds.gem}`;
    case "gear-enchant":
      return `${variable.enchantmentName ?? `#${variable.enchantmentId}`} · ${copy.kinds.enchant}`;
    case "talent-node":
    case "pvp-talent": {
      const tree = copy.trees[(variable.talentTree ?? "class") as TalentTree];
      return `${variable.talentName ?? `#${variable.talentId}`} · ${tree}`;
    }
    default: {
      const name = variable.itemName ?? `#${variable.itemId}`;
      const group = variable.slotGroup;
      return group === null ? name : `${name} · ${slots[group] ?? group}`;
    }
  }
}

/**
 * Las etiquetas de slot, normalizadas al grupo con el que se agregó.
 *
 * Se derivan de las que ya existen en vez de escribir otra lista: los dos
 * anillos comparten etiqueta y comparten grupo, así que plegarlas con la misma
 * función que pliega el dato deja imposible que las dos listas se separen.
 */
function groupLabels(slots: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(slots).map(([slot, label]) => [slotGroup(slot), label]));
}
