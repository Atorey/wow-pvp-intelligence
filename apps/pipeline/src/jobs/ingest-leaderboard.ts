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
import { createPool } from "../db/pool";
import type { LeaderboardFile } from "./fetch-leaderboard";

interface LeaderboardEntry {
  character: { name: string; id: number; realm: { slug: string } };
  faction?: { type: string };
  rank: number;
  rating: number;
  season_match_statistics?: { played: number; won: number; lost: number };
  tier?: { id: number };
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

async function ingestFile(
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

  const entries = ((content.leaderboard as { entries?: LeaderboardEntry[] })?.entries ?? []).filter(
    (e) => e?.character?.name && e?.character?.realm?.slug,
  );
  if (entries.length === 0) return { snapshots: 0 };

  const nameSlugs = entries.map((e) => e.character.name.toLowerCase());
  const realmSlugs = entries.map((e) => e.character.realm.slug);

  const client = await pool.connect();
  try {
    await client.query("begin");

    // 1) Upsert de identidades. La identidad es (region, realm, name): estable
    //    aunque cambie rating o spec.
    await client.query(
      `insert into characters (region, realm_slug, name_slug, name_display, faction, blizzard_character_id)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[])
       on conflict (region, realm_slug, name_slug)
       do update set name_display = excluded.name_display,
                     faction = excluded.faction,
                     blizzard_character_id = excluded.blizzard_character_id`,
      [
        entries.map(() => region),
        realmSlugs,
        nameSlugs,
        entries.map((e) => e.character.name),
        entries.map((e) => e.faction?.type ?? null),
        entries.map((e) => e.character.id),
      ],
    );

    // 2) Resolver los ids recién insertados/actualizados.
    const idRows = await client.query<{ id: string; realm_slug: string; name_slug: string }>(
      `select c.id, c.realm_slug, c.name_slug
       from unnest($2::text[], $3::text[]) as u(realm_slug, name_slug)
       join characters c on c.region = $1 and c.realm_slug = u.realm_slug and c.name_slug = u.name_slug`,
      [region, realmSlugs, nameSlugs],
    );
    const idByKey = new Map(idRows.rows.map((r) => [`${r.realm_slug}|${r.name_slug}`, r.id]));

    // 3) Snapshots: siempre INSERT, nunca UPDATE (modelo append-only, §27).
    //    captured_at = fetchedAt del archivo, no now(): así reingerir el mismo
    //    archivo choca contra el índice único y no duplica población.
    const rows = entries.flatMap((e) => {
      const id = idByKey.get(`${e.character.realm.slug}|${e.character.name.toLowerCase()}`);
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
async function printDistribution(pool: pg.Pool): Promise<void> {
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
