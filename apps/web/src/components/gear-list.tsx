import type { GearItemRead } from "@wowpvp/data";

import { qualityColor } from "../design/quality-color";
import { copyFor } from "../i18n/copy";
import { formatCount, formatDate } from "../i18n/format";
import type { Locale } from "../i18n/locales";
import { SectionCard } from "./section-card";

/**
 * El equipo observado del personaje, slot a slot.
 *
 * Es su dato, no un agregado: no hay muestra ni confianza que declarar, hay una
 * fecha. Y esa fecha importa —el rating es de hoy y el equipo es del día en que
 * se descargó su perfil—, así que se escribe debajo en vez de dejarla suponer.
 */
export function GearList({
  locale,
  items,
  observedAt,
}: {
  locale: Locale;
  items: readonly GearItemRead[];
  observedAt: Date;
}) {
  const copy = copyFor(locale).player.gear;

  return (
    <SectionCard title={copy.title}>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{copy.empty}</p>
      ) : (
        <>
          <ul className="flex flex-col">
            {items.map((item) => (
              <GearRow key={item.slot} locale={locale} item={item} />
            ))}
          </ul>
          <p className="text-muted-foreground max-w-measure text-sm">
            {copy.note(formatDate(observedAt, locale))}
          </p>
        </>
      )}
    </SectionCard>
  );
}

/**
 * Una pieza: hueco de icono, slot, nombre e item level.
 *
 * **El hueco del icono se reserva siempre** (§4.5 del brief). El PNG vive en un
 * servidor de Blizzard y no se re-aloja (decisión 7 del ADR 0015), así que
 * puede no haber URL o puede dejar de responder; en los dos casos la fila
 * conserva su forma en vez de recolocarse. El nombre y el item level son la
 * información, el icono solo acompaña — igual que el color de calidad.
 */
function GearRow({ locale, item }: { locale: Locale; item: GearItemRead }) {
  const copy = copyFor(locale).player.gear;
  const color = qualityColor(item.quality);
  const slots: Record<string, string> = copy.slots;

  return (
    <li className="border-border flex items-center gap-3 border-b py-2 last:border-b-0">
      <span
        className={`bg-secondary flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md border ${color.border}`}
      >
        {item.iconUrl !== null && (
          /*
           * `img` y no `next/image`: optimizar la imagen es servirla desde
           * nuestro dominio, y eso es "making publicly available" el Material de
           * Blizzard, que es justo lo que el ADR 0015 no permite. Se enlaza la
           * copia que ellos ya publican.
           *
           * Sin `alt`: el nombre del item está escrito al lado, así que
           * repetirlo aquí obligaría a un lector de pantalla a decirlo dos
           * veces. El icono es decoración de una fila que ya se entiende.
           */
          <img src={item.iconUrl} alt="" width={40} height={40} loading="lazy" />
        )}
      </span>
      <span className="text-subtle-foreground w-24 shrink-0 text-sm">
        {slots[item.slot] ?? item.slot}
      </span>
      <span className={`min-w-0 grow text-sm ${color.text}`}>
        {item.itemName ?? `#${item.itemId}`}
      </span>
      {item.itemLevel !== null && (
        <span className="text-foreground font-display text-base">
          {formatCount(item.itemLevel, locale)}
        </span>
      )}
    </li>
  );
}
