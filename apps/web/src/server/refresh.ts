import {
  BlizzardClient,
  getCharacterLookupTtlMinutes,
  getNotFoundCacheTtlMinutes,
  getLookupTimeBudgetMs,
  getRegion,
  lookupCharacter,
} from "@wowpvp/blizzard";
import type { PlayerRoute } from "@wowpvp/core";
import { getDb } from "./db";
import "./env";
import { logServerEvent } from "./log";

/**
 * Volver a preguntarle a Blizzard por un personaje que ya está en la población.
 *
 * Es la misma llamada que hace el buscador cuando alguien no está (ADR 0024),
 * con la misma prioridad `on-demand` y el mismo presupuesto de tiempo, y por
 * eso vive junto a ella y no dentro de la página: **escribe**, así que solo
 * puede colgar de un POST.
 *
 * `force` se queda en `false` a propósito. El TTL de §28 existe para que
 * consultar cinco veces al mismo personaje no cueste cinco fichas de una cuota
 * que se comparte con el pipeline, y un botón que lo ignore convierte ese ahorro
 * en un botón de gastar. Cuando el perfil está fresco, la respuesta es `cached`
 * y la página lo dice en vez de fingir que ha refrescado algo.
 */

/**
 * Cómo acabó el botón, que no es lo mismo que qué devolvió `refreshCharacter`.
 *
 * `rate-limited` es el único que esa función no puede producir: lo decide la
 * acción antes de llamarla, porque el sentido de un límite por IP es no llegar a
 * gastar la petición. Quien busque aquí su `return` no lo va a encontrar.
 */
export type RefreshStatus = "updated" | "cached" | "unavailable" | "not-found" | "rate-limited";

export const REFRESH_STATUSES: readonly RefreshStatus[] = [
  "updated",
  "cached",
  "unavailable",
  "not-found",
  "rate-limited",
];

export function isRefreshStatus(value: string): value is RefreshStatus {
  return (REFRESH_STATUSES as readonly string[]).includes(value);
}

export async function refreshCharacter(route: PlayerRoute): Promise<RefreshStatus> {
  const db = getDb();
  const client = new BlizzardClient({
    db,
    priority: "on-demand",
    timeBudgetMs: getLookupTimeBudgetMs(),
  });

  const result = await lookupCharacter(
    {
      pool: db,
      client,
      region: getRegion(),
      ttlMinutes: getCharacterLookupTtlMinutes(),
      notFoundTtlMinutes: getNotFoundCacheTtlMinutes(),
      force: false,
    },
    { realmSlug: route.realmSlug, nameSlug: route.nameSlug },
  );

  // "No se pudo mirar" nunca se enseña como "no existe" (ADR 0013, decisión 7):
  // son cosas distintas y el jugador que tiene delante su propio personaje
  // sabría que la segunda es mentira.
  // Que la cola esté saturada lo ve el jugador como "ahora no puedo mirarlo",
  // y hasta aquí no lo veía nadie más. La causa —sin cuota o sin tiempo— no le
  // sirve a él y sí a quien opera: es la diferencia entre haber tocado el techo
  // horario y estar simplemente lento (ADR 0031).
  if (result.unavailable) {
    logServerEvent("blizzard-unavailable", { reason: result.unavailable, source: "refresh" });
    return "unavailable";
  }
  // Las dos formas de "no existe" dicen lo mismo a quien mira: que la segunda
  // no costó petición es cosa nuestra. Nombrarla evita que caiga al "updated"
  // final y la página afirme haber refrescado a alguien que no está.
  if (result.outcome === "not-found" || result.outcome === "not-found-cached") return "not-found";
  if (result.outcome === "cached") return "cached";
  return "updated";
}
