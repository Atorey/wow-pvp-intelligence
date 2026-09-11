import { isAggregateStale } from "@wowpvp/core";

import { copyFor } from "../i18n/copy";
import { formatDate } from "../i18n/format";
import type { Locale } from "../i18n/locales";

/**
 * De qué corrida salen las cifras agregadas de un bloque, y si esa corrida ya
 * se quedó atrás.
 *
 * La fecha va **siempre**, no solo cuando algo va mal: el §28 del plan pide que
 * ninguna cifra agregada se enseñe sin poder trazar de dónde sale y cuándo se
 * calculó, y el principio 8 es el mismo compromiso dicho de otra manera. La
 * comparten la caja Player Gap y las páginas de spec porque es la misma frase
 * sobre el mismo dato.
 *
 * El aviso de corrida vieja no es un `Alert`. Sigue la distinción de la §5.0 del
 * sistema visual: `role="alert"` es una región viva, para algo que cambia
 * mientras miras, y esto ya estaba así antes de entrar en la página. Es texto,
 * como el resto de ausencias declaradas, y se lee igual sin distinguir colores.
 */
export function RunProvenance({ locale, computedAt }: { locale: Locale; computedAt: Date | null }) {
  const copy = copyFor(locale).aggregates;
  // Sin fecha no hay corrida de la que hablar: ese escalón no se ha calculado
  // nunca, y quien pinta el bloque ya lo está diciendo con sus propias palabras.
  if (computedAt === null) return null;

  const when = formatDate(computedAt, locale);
  // El reloj se lee aquí, en el servidor, y no se guarda en el estado: la
  // vejez de un dato depende de cuándo se mira, no de cuándo se calculó.
  const stale = isAggregateStale(computedAt, new Date());

  return (
    <div className="flex flex-col gap-1">
      <p className="text-subtle-foreground text-sm">{copy.computedAt(when)}</p>
      {stale && (
        <p className="text-muted-foreground max-w-measure text-sm">{copy.staleRun(when)}</p>
      )}
    </div>
  );
}
