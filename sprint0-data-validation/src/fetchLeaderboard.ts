import * as fs from "fs";
import * as path from "path";
import { blizzardGet, REGION_IN_USE } from "./blizzard";
import { SPECS_TO_FETCH, shuffleBracketId, SpecEntry } from "./specs";

const DATA_DIR = path.join(__dirname, "..", "data", "leaderboard");

// Si quieres saltarte la detección automática (por ejemplo, porque ya viste
// el id correcto en pvp-season-index-raw.json), ponlo aquí y el script lo
// usará directamente sin llamar a getCurrentSeasonId().
const SEASON_ID_OVERRIDE: number | null = null;

async function getCurrentSeasonId(): Promise<number> {
  const indexRes = await blizzardGet("/data/wow/pvp-season/index", "dynamic");
  if (!indexRes.ok) {
    throw new Error(`No se pudo leer /data/wow/pvp-season/index: HTTP ${indexRes.status} — ${indexRes.error}`);
  }

  const data = indexRes.data;

  // Estrategia 1: el índice trae un campo explícito current_season.
  const currentHref: string | undefined = data?.current_season?.href;
  if (currentHref) {
    const currentPath = new URL(currentHref).pathname;
    const currentRes = await blizzardGet(currentPath, "dynamic");
    if (currentRes.ok && typeof currentRes.data?.id === "number") {
      return currentRes.data.id;
    }
  }

  // Estrategia 2: no hay current_season — asumimos que la temporada activa
  // es la de mayor id dentro de data.seasons (lista de {id, key:{href}}).
  // Es una asunción razonable (las temporadas son correlativas) pero no
  // confirmada — por eso se avisa explícitamente por consola.
  const seasons: any[] = data?.seasons ?? [];
  if (Array.isArray(seasons) && seasons.length > 0) {
    const withIds = seasons.filter((s) => typeof s.id === "number");
    if (withIds.length > 0) {
      const maxId = Math.max(...withIds.map((s) => s.id));
      console.warn(
        `⚠️  El índice no trae "current_season" explícito. Asumiendo que la temporada ` +
          `actual es la de mayor id encontrada en "seasons": ${maxId}. Verifícalo tú ` +
          `mismo mirando pvp-season-index-raw.json antes de confiar en esto a ciegas.`
      );
      fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(path.join(DATA_DIR, "..", "pvp-season-index-raw.json"), JSON.stringify(data, null, 2));
      return maxId;
    }
  }

  // Estrategia 3: no se pudo deducir nada — volcamos el JSON crudo y paramos
  // en vez de adivinar más.
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const debugPath = path.join(DATA_DIR, "..", "pvp-season-index-raw.json");
  fs.writeFileSync(debugPath, JSON.stringify(data, null, 2));
  throw new Error(
    `No se pudo determinar la temporada actual automáticamente. He guardado la ` +
      `respuesta cruda en ${debugPath} — compártela para ajustar el parseo, o abre ` +
      `ese archivo tú mismo y busca el id de la temporada más reciente para ` +
      `pasarlo manualmente (ver SEASON_ID_OVERRIDE más abajo en este archivo).`
  );
}

interface LeaderboardSummary {
  spec: string;
  bracket: string;
  seasonId: number;
  entriesFound: number;
  topRating: number | null;
  cutoffRating: number | null; // rating del último jugador dentro del top devuelto (aprox. corte del top 5000)
  warning?: string;
}

async function fetchLeaderboardForSpec(spec: SpecEntry, seasonId: number): Promise<LeaderboardSummary> {
  const bracket = shuffleBracketId(spec);
  const res = await blizzardGet(`/data/wow/pvp-season/${seasonId}/pvp-leaderboard/${bracket}`, "dynamic");

  const summary: LeaderboardSummary = {
    spec: spec.label,
    bracket,
    seasonId,
    entriesFound: 0,
    topRating: null,
    cutoffRating: null,
  };

  if (!res.ok) {
    summary.warning = `HTTP ${res.status} — endpoint falló para este bracket. ${res.error?.slice(0, 200) ?? ""}`;
    return summary;
  }

  const entries = res.data?.entries ?? [];
  summary.entriesFound = entries.length;

  if (entries.length === 0) {
    // Este bracket concreto tiene un historial documentado de devolver vacío
    // en ciertas combinaciones namespace/season — ver sección 30 del plan
    // ("Pvp-leaderboard endpoint no data for solo shuffles", foro oficial).
    summary.warning =
      "0 entradas. El endpoint respondió OK pero sin datos — es un fallo conocido y documentado " +
      "para algunos brackets de Solo Shuffle en ciertas temporadas. No asumas que la spec no se juega; " +
      "reintenta más tarde o prueba otra temporada antes de descartar la spec.";
  } else {
    const ratings = entries.map((e: any) => e.rating).filter((r: any) => typeof r === "number");
    summary.topRating = Math.max(...ratings);
    summary.cutoffRating = Math.min(...ratings);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const outPath = path.join(DATA_DIR, `${bracket}-season${seasonId}.json`);
  fs.writeFileSync(outPath, JSON.stringify(res.data, null, 2));

  return summary;
}

async function main() {
  console.log(`Región: ${REGION_IN_USE.toUpperCase()}`);
  let seasonId: number;
  if (SEASON_ID_OVERRIDE !== null) {
    seasonId = SEASON_ID_OVERRIDE;
    console.log(`Usando SEASON_ID_OVERRIDE = ${seasonId} (detección automática saltada).\n`);
  } else {
    console.log("Resolviendo temporada actual de PvP...");
    seasonId = await getCurrentSeasonId();
    console.log(`Temporada actual: ${seasonId}\n`);
  }

  console.log(`Descargando leaderboard de Solo Shuffle para ${SPECS_TO_FETCH.length} specs...\n`);

  const summaries: LeaderboardSummary[] = [];
  for (const spec of SPECS_TO_FETCH) {
    console.log(`→ ${spec.label} (${shuffleBracketId(spec)}) ...`);
    const summary = await fetchLeaderboardForSpec(spec, seasonId);
    summaries.push(summary);
  }

  console.log("\n=== REPORTE — LEADERBOARD SOLO SHUFFLE (Sprint 0, días 3-5) ===\n");
  for (const s of summaries) {
    const status = s.entriesFound > 0 ? "✅" : "⚠️";
    console.log(`${status} ${s.spec} (${s.bracket})`);
    console.log(`   Entradas descargadas: ${s.entriesFound}${s.entriesFound >= 5000 ? " (tope de 5.000 alcanzado)" : ""}`);
    if (s.topRating !== null) console.log(`   Rating máximo: ${s.topRating} — corte inferior del top devuelto: ${s.cutoffRating}`);
    if (s.warning) console.log(`   ⚠️  ${s.warning}`);
    console.log("");
  }

  const totalEntries = summaries.reduce((acc, s) => acc + s.entriesFound, 0);
  console.log(`Total de personajes descargados (crudo, antes de deduplicar): ${totalEntries}`);
  console.log(`Dataset guardado en: ${DATA_DIR}`);
  console.log(
    "\nSiguiente paso del Sprint 0 (días 5-7): diseñar el schema mínimo de Postgres " +
      "(Character, CharacterSnapshot, Build, Gear, PvPBracketStat — sección 27 del plan) " +
      "e ingerir este dataset crudo."
  );
}

main().catch((err) => {
  console.error("Error descargando el leaderboard:", err);
  process.exit(1);
});
