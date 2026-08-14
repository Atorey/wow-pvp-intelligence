import fs from "node:fs";
import path from "node:path";
import { shuffleBracketId, type SpecEntry } from "@wowpvp/core";
import { BlizzardClient } from "../blizzard/client";
import { LEADERBOARD_DIR } from "../config";
import { SPECS_TO_INGEST } from "../specs-to-ingest";

/**
 * Formato en el que guardamos cada descarga. El `fetchedAt` no es decorativo:
 * es el captured_at con el que entran los snapshots en la base de datos, y lo
 * que hace que reingerir el mismo archivo sea idempotente.
 */
export interface LeaderboardFile {
  fetchedAt: string;
  region: string;
  seasonId: number;
  bracket: string;
  leaderboard: unknown;
}

interface SeasonIndex {
  current_season?: { href?: string };
  seasons?: { id?: number }[];
}

async function resolveCurrentSeasonId(client: BlizzardClient): Promise<number> {
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

interface LeaderboardSummary {
  spec: string;
  bracket: string;
  entries: number;
  topRating: number | null;
  cutoffRating: number | null;
  warning?: string;
}

async function fetchSpec(
  client: BlizzardClient,
  spec: SpecEntry,
  seasonId: number,
  fetchedAt: string,
): Promise<LeaderboardSummary> {
  const bracket = shuffleBracketId(spec);
  const res = await client.tryGet<{ entries?: { rating?: number }[] }>(
    `/data/wow/pvp-season/${seasonId}/pvp-leaderboard/${bracket}`,
    "dynamic",
  );

  const summary: LeaderboardSummary = {
    spec: spec.label,
    bracket,
    entries: 0,
    topRating: null,
    cutoffRating: null,
  };

  if (!res.ok || !res.data) {
    summary.warning = `HTTP ${res.status} — ${res.error?.slice(0, 200) ?? "sin cuerpo"}`;
    return summary;
  }

  const entries = res.data.entries ?? [];
  summary.entries = entries.length;

  if (entries.length === 0) {
    // Fallo documentado en el foro oficial: el endpoint responde 200 con 0
    // entradas para ciertos brackets de shuffle según temporada/namespace.
    summary.warning =
      "0 entradas con respuesta OK. Es un fallo conocido para algunos brackets de Solo Shuffle: " +
      "no asumas que la spec no se juega, reintenta más tarde antes de descartarla.";
  } else {
    const ratings = entries.map((e) => e.rating).filter((r): r is number => typeof r === "number");
    summary.topRating = Math.max(...ratings);
    summary.cutoffRating = Math.min(...ratings);
  }

  const file: LeaderboardFile = {
    fetchedAt,
    region: client.region,
    seasonId,
    bracket,
    leaderboard: res.data,
  };

  fs.mkdirSync(LEADERBOARD_DIR, { recursive: true });
  const stamp = fetchedAt.replace(/[-:]/g, "").replace(/\..+$/, "");
  fs.writeFileSync(
    path.join(LEADERBOARD_DIR, `${bracket}-season${seasonId}-${stamp}.json`),
    JSON.stringify(file, null, 2),
  );

  return summary;
}

export async function fetchLeaderboards(): Promise<void> {
  const client = new BlizzardClient();
  console.log(`Región: ${client.region.toUpperCase()}`);

  const seasonId = await resolveCurrentSeasonId(client);
  console.log(`Temporada actual: ${seasonId}`);
  console.log(`Descargando leaderboard de Solo Shuffle para ${SPECS_TO_INGEST.length} specs...\n`);

  const fetchedAt = new Date().toISOString();
  const summaries: LeaderboardSummary[] = [];
  for (const spec of SPECS_TO_INGEST) {
    console.log(`→ ${spec.label} (${shuffleBracketId(spec)}) ...`);
    summaries.push(await fetchSpec(client, spec, seasonId, fetchedAt));
  }

  console.log("\n=== LEADERBOARD SOLO SHUFFLE ===\n");
  for (const s of summaries) {
    console.log(`${s.entries > 0 ? "✅" : "⚠️"} ${s.spec} (${s.bracket})`);
    console.log(
      `   Entradas: ${s.entries}${s.entries >= 5000 ? " (tope de 5.000 alcanzado)" : ""}`,
    );
    if (s.topRating !== null) {
      console.log(`   Rating máximo: ${s.topRating} — corte inferior: ${s.cutoffRating}`);
    }
    if (s.warning) console.log(`   ⚠️  ${s.warning}`);
    console.log("");
  }

  const total = summaries.reduce((acc, s) => acc + s.entries, 0);
  console.log(`Total descargado (crudo, sin deduplicar): ${total}`);
  console.log(`Dataset en: ${LEADERBOARD_DIR}`);
  console.log(`\nSiguiente paso: npm run pipeline -- ingest-leaderboard`);
}
