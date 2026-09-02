import type { BlizzardClient } from "./client";

/**
 * Qué temporada es la de ahora, según Blizzard.
 *
 * Vive en el paquete y no en el job que descarga leaderboards porque la
 * búsqueda bajo demanda necesita lo mismo: `season_id` es not null y adivinarlo
 * mal mete el snapshot en la temporada equivocada, así que las dos fuentes de
 * población tienen que preguntarlo igual.
 */
interface SeasonIndex {
  current_season?: { href?: string };
  seasons?: { id?: number }[];
}

export async function resolveCurrentSeasonId(client: BlizzardClient): Promise<number> {
  const index = await client.get<SeasonIndex>("/data/wow/pvp-season/index", "dynamic");

  // 1) El índice trae la temporada actual explícita.
  const href = index.current_season?.href;
  if (href) {
    const current = await client.tryGet<{ id?: number }>(new URL(href).pathname, "dynamic");
    if (current.ok && typeof current.data?.id === "number") return current.data.id;
  }

  // 2) No la trae: asumimos la de mayor id (las temporadas son correlativas).
  //    Es una asunción, así que se avisa en vez de aplicarla en silencio.
  const ids = (index.seasons ?? [])
    .map((s) => s.id)
    .filter((id): id is number => typeof id === "number");
  if (ids.length > 0) {
    const maxId = Math.max(...ids);
    console.warn(
      `⚠️  El índice no trae "current_season". Asumiendo la temporada de mayor id: ${maxId}. ` +
        `Verifícalo antes de fiarte de una ingesta completa.`,
    );
    return maxId;
  }

  throw new Error(
    "No se pudo determinar la temporada actual: /data/wow/pvp-season/index no trae ni " +
      "current_season ni una lista de seasons con id.",
  );
}
