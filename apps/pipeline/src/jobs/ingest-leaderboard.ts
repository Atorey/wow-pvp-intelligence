import fs from "node:fs";
import path from "node:path";
import type pg from "pg";
import {
  DEFAULT_SEGMENT_SCALE,
  confidenceFor,
  formatSegment,
  parseShuffleBracket,
  segmentFor,
} from "@wowpvp/core";
import { LEADERBOARD_DIR, getRegion } from "../config";
import { identityKey, upsertCharacters } from "../db/characters";
import { createPool } from "../db/pool";
import type { LeaderboardFile } from "./fetch-leaderboard";

export interface LeaderboardEntry {
  character: { name: string; id: number; realm: { slug: string } };
  faction?: { type: string };
  rank: number;
  rating: number;
  season_match_statistics?: { played: number; won: number; lost: number };
  tier?: { id: number };
}

/**
 * Una sola entrada por personaje dentro de un archivo. Blizzard no lo garantiza:
 * un personaje transferido o renombrado puede salir dos veces en la misma
 * publicación, bajo dos identidades (reino, nombre) pero con el mismo
 * `character.id` — y entonces el upsert intenta escribir ese id en dos filas
 * dentro de la misma sentencia y choca contra idx_characters_blizzard_id, que no
 * es el arbiter del `on conflict` y por tanto aborta la ingesta entera.
 *
 * Se conserva la entrada mejor clasificada y se descartan las demás: entre dos
 * apariciones del mismo personaje, la de rank más bajo es la viva; la otra es el
 * residuo de la identidad anterior. Quedarse con las dos contaría al jugador dos
 * veces en la población, es decir, en el n que sostiene la confianza declarada
 * (ADR 0003).
 */
export function dedupeEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  const seenIds = new Set<number>();
  const seenIdentities = new Set<string>();
  const kept: LeaderboardEntry[] = [];

  // Ordenamos por rank en vez de fiarnos del orden recibido: cuál de las dos
  // apariciones sobrevive no puede depender de cómo venga serializado el JSON.
  for (const entry of [...entries].sort((a, b) => a.rank - b.rank)) {
    const identity = `${entry.character.realm.slug}|${entry.character.name.toLowerCase()}`;
    const id = entry.character.id;
    const hasId = typeof id === "number";

    // Sin id no se deduplica por id: agrupar todos los "sin id" bajo la misma
    // clave descartaría personajes distintos (regla 5, null es "no disponible").
    if (seenIdentities.has(identity) || (hasId && seenIds.has(id))) continue;

    seenIdentities.add(identity);
    if (hasId) seenIds.add(id);
    kept.push(entry);
  }

  return kept;
}

function readLeaderboardFiles(): { file: string; content: LeaderboardFile }[] {
  if (!fs.existsSync(LEADERBOARD_DIR)) return [];

  return fs
    .readdirSync(LEADERBOARD_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => ({
      file: f,
      content: JSON.parse(
        fs.readFileSync(path.join(LEADERBOARD_DIR, f), "utf-8"),
      ) as LeaderboardFile,
    }));
}

export async function ingestFile(
  pool: pg.Pool,
  region: string,
  content: LeaderboardFile,
): Promise<{ snapshots: number }> {
  const spec = parseShuffleBracket(content.bracket);
  if (!spec) {
    throw new Error(
      `Bracket "${content.bracket}" no está en el catálogo de specs de @wowpvp/core.`,
    );
  }

  const received = (
    (content.leaderboard as { entries?: LeaderboardEntry[] })?.entries ?? []
  ).filter((e) => e?.character?.name && e?.character?.realm?.slug);

  const entries = dedupeEntries(received);
  const duplicated = received.length - entries.length;
  if (duplicated > 0)
    console.warn(
      `  ⚠️  ${duplicated} entrada(s) del mismo personaje repetidas en la publicación, descartadas.`,
    );

  if (entries.length === 0) return { snapshots: 0 };

  const client = await pool.connect();
  try {
    await client.query("begin");

    // 1) Identidades. La reconciliación de renombres y transferencias vive en
    //    db/characters.ts: la comparte con la búsqueda bajo demanda, que se topa
    //    con exactamente el mismo caso.
    const idByKey = await upsertCharacters(
      client,
      region,
      entries.map((e) => ({
        realmSlug: e.character.realm.slug,
        nameSlug: e.character.name.toLowerCase(),
        nameDisplay: e.character.name,
        faction: e.faction?.type ?? null,
        blizzardCharacterId: e.character.id ?? null,
      })),
    );

    // 2) Snapshots: siempre INSERT, nunca UPDATE (modelo append-only, §27).
    //    captured_at = fetchedAt del archivo, no now(): así reingerir el mismo
    //    archivo choca contra el índice único y no duplica población.
    const rows = entries.flatMap((e) => {
      const id = idByKey.get(identityKey(e.character.realm.slug, e.character.name.toLowerCase()));
      return id ? [{ id, entry: e }] : [];
    });

    const skipped = entries.length - rows.length;
    if (skipped > 0)
      console.warn(`  ⚠️  ${skipped} entradas sin character_id resoluble (revisar).`);

    const result = await client.query(
      `insert into character_snapshots
         (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
          rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id)
       select * from unnest(
         $1::uuid[], $2::timestamptz[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[],
         $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[]
       )
       on conflict (character_id, bracket, captured_at) do nothing`,
      [
        rows.map((r) => r.id),
        rows.map(() => content.fetchedAt),
        rows.map(() => "leaderboard"),
        rows.map(() => content.seasonId),
        rows.map(() => content.bracket),
        rows.map(() => spec.classSlug),
        rows.map(() => spec.specSlug),
        rows.map((r) => r.entry.rating),
        rows.map((r) => r.entry.rank),
        rows.map((r) => r.entry.season_match_statistics?.played ?? null),
        rows.map((r) => r.entry.season_match_statistics?.won ?? null),
        rows.map((r) => r.entry.season_match_statistics?.lost ?? null),
        rows.map((r) => r.entry.tier?.id ?? null),
      ],
    );

    await client.query("commit");
    return { snapshots: result.rowCount ?? 0 };
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Distribución actual de población por segmento de rating. Se calcula sobre la
 * vista de "último snapshot por personaje y bracket", no sobre la tabla cruda:
 * contar snapshots contaría dos veces al mismo jugador tras la segunda ingesta.
 */
export async function printDistribution(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query<{ bracket: string; rating: number }>(
    `select bracket, rating from latest_snapshot_per_character_bracket`,
  );

  const counts = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const segment = segmentFor(row.rating, DEFAULT_SEGMENT_SCALE);
    const perBracket = counts.get(row.bracket) ?? new Map<string, number>();
    perBracket.set(segment.id, (perBracket.get(segment.id) ?? 0) + 1);
    counts.set(row.bracket, perBracket);
  }

  console.log("\n=== DISTRIBUCIÓN DE POBLACIÓN POR SEGMENTO ===");
  console.log("(confianza según §13.4: high n≥100, medium n≥30, por debajo no se compara)\n");

  for (const [bracket, perBracket] of [...counts].sort()) {
    console.log(`${parseShuffleBracket(bracket)?.label ?? bracket}:`);
    const segments = [...perBracket].sort(
      (a, b) => Number(a[0].split("-")[0]) - Number(b[0].split("-")[0]),
    );
    for (const [segmentId, n] of segments) {
      const min = Number(segmentId.split("-")[0]);
      console.log(`  ${formatSegment(segmentFor(min))}: n=${n} (${confidenceFor(n)})`);
    }
    console.log("");
  }
}

export async function ingestLeaderboards(): Promise<void> {
  const files = readLeaderboardFiles();
  if (files.length === 0) {
    console.log(
      `No hay archivos de leaderboard en ${LEADERBOARD_DIR}.\n` +
        `Ejecuta antes: npm run pipeline -- fetch-leaderboard`,
    );
    return;
  }

  const region = getRegion();
  const pool = createPool();

  try {
    console.log(`Ingiriendo ${files.length} archivo(s) (región ${region})...\n`);

    let total = 0;
    for (const { file, content } of files) {
      const label = parseShuffleBracket(content.bracket)?.label ?? content.bracket;
      const { snapshots } = await ingestFile(pool, region, content);
      total += snapshots;
      console.log(`→ ${label} (${file}): ${snapshots} snapshots nuevos`);
    }

    console.log(`\nTotal: ${total} snapshots insertados (los repetidos se ignoran).`);
    await printDistribution(pool);
  } finally {
    await pool.end();
  }
}
