import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { ALL_SPECS, shuffleBracketId, SpecEntry } from "./specs";

const DATA_DIR = path.join(__dirname, "..", "data", "leaderboard");
const REGION = process.env.BLIZZARD_REGION || "eu";

if (!process.env.DATABASE_URL) {
  throw new Error(
    "Falta DATABASE_URL en .env. Cópiala desde Supabase: Project Settings → Database → " +
      "Connection string (usa la variante 'URI', modo 'Session' o 'Transaction' según tu plan)."
  );
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase requiere SSL; en local (localhost) normalmente no.
  ssl: process.env.DATABASE_URL.includes("localhost") ? false : { rejectUnauthorized: false },
});

interface ParsedFile {
  filePath: string;
  spec: SpecEntry;
  bracket: string;
  seasonId: number;
}

/**
 * En vez de parsear el nombre de clase/spec a partir del string del bracket
 * (ambiguo: "shuffle-demon-hunter-havoc" no se puede partir de forma fiable
 * por guiones), comparamos cada archivo contra el catálogo canónico de
 * ALL_SPECS que ya usamos para generar los brackets al descargarlos.
 */
function matchFilesToSpecs(): ParsedFile[] {
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith(".json"));
  const parsed: ParsedFile[] = [];

  for (const file of files) {
    const m = file.match(/^(.+)-season(\d+)\.json$/);
    if (!m) continue;
    const [, bracketPart, seasonStr] = m;

    const spec = ALL_SPECS.find((s) => shuffleBracketId(s) === bracketPart);
    if (!spec) {
      console.warn(`⚠️  No pude asociar el archivo "${file}" a ninguna spec conocida — se ignora.`);
      continue;
    }

    parsed.push({
      filePath: path.join(DATA_DIR, file),
      spec,
      bracket: bracketPart,
      seasonId: parseInt(seasonStr, 10),
    });
  }

  return parsed;
}

interface LeaderboardEntry {
  character: { name: string; id: number; realm: { slug: string } };
  faction?: { type: string };
  rank: number;
  rating: number;
  season_match_statistics?: { played: number; won: number; lost: number };
  tier?: { id: number };
}

async function ingestFile(pf: ParsedFile) {
  const raw = fs.readFileSync(pf.filePath, "utf-8");
  const data = JSON.parse(raw);
  const entries: LeaderboardEntry[] = data?.entries ?? [];

  if (entries.length === 0) {
    console.log(`  (0 entradas en ${path.basename(pf.filePath)}, se salta)`);
    return { characters: 0, snapshots: 0 };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // --- Fase 1: upsert de characters, en bloque con unnest ---
    const nameSlugs = entries.map((e) => e.character.name.toLowerCase());
    const realmSlugs = entries.map((e) => e.character.realm.slug);
    const nameDisplays = entries.map((e) => e.character.name);
    const factions = entries.map((e) => e.faction?.type ?? null);
    const blizzardIds = entries.map((e) => e.character.id);
    const regions = entries.map(() => REGION);

    await client.query(
      `insert into characters (region, realm_slug, name_slug, name_display, faction, blizzard_character_id)
       select * from unnest($1::text[], $2::text[], $3::text[], $4::text[], $5::text[], $6::bigint[])
       on conflict (region, realm_slug, name_slug)
       do update set name_display = excluded.name_display,
                      faction = excluded.faction,
                      blizzard_character_id = excluded.blizzard_character_id`,
      [regions, realmSlugs, nameSlugs, nameDisplays, factions, blizzardIds]
    );

    // --- Fase 2: resolver character_id para cada entrada ---
    // (join contra una tabla derivada vía unnest — es el enfoque fiable para
    // resolver pares (realm_slug, name_slug) -> id sin arrastrar ambigüedad)
    const idMap = new Map<string, string>(); // key: realm_slug|name_slug -> character_id
    const idRows = await client.query<{ id: string; realm_slug: string; name_slug: string }>(
      `select c.id, u.realm_slug, u.name_slug
       from unnest($2::text[], $3::text[]) as u(realm_slug, name_slug)
       join characters c
         on c.region = $1 and c.realm_slug = u.realm_slug and c.name_slug = u.name_slug`,
      [REGION, realmSlugs, nameSlugs]
    );
    for (const row of idRows.rows) {
      idMap.set(`${row.realm_slug}|${row.name_slug}`, row.id);
    }

    // --- Fase 3: insertar snapshots (siempre INSERT, nunca UPDATE — append-only) ---
    const characterIds: string[] = [];
    const brackets: string[] = [];
    const classSlugs: string[] = [];
    const specSlugs: string[] = [];
    const ratings: number[] = [];
    const ranks: number[] = [];
    const played: (number | null)[] = [];
    const won: (number | null)[] = [];
    const lost: (number | null)[] = [];
    const tierIds: (number | null)[] = [];

    let skipped = 0;
    for (const e of entries) {
      const key = `${e.character.realm.slug}|${e.character.name.toLowerCase()}`;
      const charId = idMap.get(key);
      if (!charId) {
        skipped++;
        continue;
      }
      characterIds.push(charId);
      brackets.push(pf.bracket);
      classSlugs.push(pf.spec.classSlug);
      specSlugs.push(pf.spec.specSlug);
      ratings.push(e.rating);
      ranks.push(e.rank);
      played.push(e.season_match_statistics?.played ?? null);
      won.push(e.season_match_statistics?.won ?? null);
      lost.push(e.season_match_statistics?.lost ?? null);
      tierIds.push(e.tier?.id ?? null);
    }

    if (skipped > 0) {
      console.warn(`  ⚠️  ${skipped} entradas no se pudieron mapear a un character_id (revisar).`);
    }

    const seasonIds = characterIds.map(() => pf.seasonId);
    const sources = characterIds.map(() => "leaderboard");

    await client.query(
      `insert into character_snapshots
         (character_id, source, season_id, bracket, class_slug, spec_slug, rating, ladder_rank,
          matches_played, matches_won, matches_lost, pvp_tier_id)
       select * from unnest(
         $1::uuid[], $2::text[], $3::int[], $4::text[], $5::text[], $6::text[],
         $7::int[], $8::int[], $9::int[], $10::int[], $11::int[], $12::int[]
       )`,
      [characterIds, sources, seasonIds, brackets, classSlugs, specSlugs, ratings, ranks, played, won, lost, tierIds]
    );

    await client.query("COMMIT");
    return { characters: idMap.size, snapshots: characterIds.length };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

async function main() {
  const files = matchFilesToSpecs();
  if (files.length === 0) {
    console.log(`No se encontraron archivos de leaderboard reconocibles en ${DATA_DIR}.`);
    return;
  }

  console.log(`Ingeriendo ${files.length} archivo(s) de leaderboard en Postgres (región ${REGION})...\n`);

  let totalChars = 0;
  let totalSnapshots = 0;

  for (const pf of files) {
    console.log(`→ ${pf.spec.label} (${pf.bracket}, season ${pf.seasonId})`);
    const result = await ingestFile(pf);
    totalChars += result.characters;
    totalSnapshots += result.snapshots;
    console.log(`  ${result.snapshots} snapshots insertados.`);
  }

  console.log(`\nTotal: ~${totalChars} personajes distintos, ${totalSnapshots} snapshots insertados.`);

  // Primera distribución real de rating por bucket de 200 (sección 27 del plan)
  const distribution = await pool.query(`
    select bracket,
           width_bucket(rating, 0, 4000, 20) as bucket,
           (width_bucket(rating, 0, 4000, 20) - 1) * 200 as bucket_min,
           count(*) as n
    from character_snapshots
    where source = 'leaderboard'
    group by bracket, bucket
    order by bracket, bucket
  `);

  console.log("\n=== DISTRIBUCIÓN DE RATING POR SEGMENTO (bucket de 200) ===");
  let currentBracket = "";
  for (const row of distribution.rows) {
    if (row.bracket !== currentBracket) {
      currentBracket = row.bracket;
      console.log(`\n${currentBracket}:`);
    }
    const confidence = row.n >= 100 ? "High" : row.n >= 30 ? "Medium" : "Low/Insufficient";
    console.log(`  ${row.bucket_min}-${Number(row.bucket_min) + 200}: n=${row.n} (${confidence})`);
  }

  await pool.end();
}

main().catch(async (err) => {
  console.error("Error en la ingesta:", err);
  await pool.end();
  process.exit(1);
});
