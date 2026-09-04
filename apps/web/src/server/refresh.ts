import {
  BlizzardClient,
  getCharacterLookupTtlMinutes,
  getLookupTimeBudgetMs,
  getRegion,
  lookupCharacter,
} from "@wowpvp/blizzard";
import type { PlayerRoute } from "@wowpvp/core";
import { getDb } from "./db";
import "./env";

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
export type RefreshStatus = "updated" | "cached" | "unavailable" | "not-found";

export const REFRESH_STATUSES: readonly RefreshStatus[] = [
  "updated",
  "cached",
  "unavailable",
  "not-found",
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
      force: false,
    },
    { realmSlug: route.realmSlug, nameSlug: route.nameSlug },
  );

  // "No se pudo mirar" nunca se enseña como "no existe" (ADR 0013, decisión 7):
  // son cosas distintas y el jugador que tiene delante su propio personaje
  // sabría que la segunda es mentira.
  if (result.unavailable) return "unavailable";
  if (result.outcome === "not-found") return "not-found";
  if (result.outcome === "cached") return "cached";
  return "updated";
}
