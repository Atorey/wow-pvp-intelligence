import "./env";

import type { GapViewEvent } from "../analytics/gap-view";
import { getDb } from "./db";

/**
 * La escritura de la medición (ADR 0028).
 *
 * Vive aquí y no en `@wowpvp/data` porque ese paquete es la capa de **lecturas**
 * de servicio (ADR 0014): las escrituras no bajan a él. Y no baja al pipeline
 * porque no hay pipeline en medio — el evento nace en el navegador de quien
 * está leyendo su Player Gap y muere en esta tabla.
 */
export async function recordGapView(event: GapViewEvent): Promise<void> {
  await getDb().query(
    `insert into player_gap_views (visitor_id, outcome, spec_slug, bracket, target_segment, locale)
     values ($1, $2, $3, $4, $5, $6)`,
    [event.visitorId, event.outcome, event.spec, event.bracket, event.segment, event.locale],
  );
}
