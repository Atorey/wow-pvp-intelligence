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

/** Lo que dejó una ingesta. `redundant` es el número que #48 necesita para decidir retención. */
export interface IngestResult {
  /** Filas nuevas en character_snapshots: las únicas que traen información. */
  snapshots: number;
  /** Entradas idénticas a la observación anterior del mismo personaje, no insertadas. */
  redundant: number;
  /** Entradas recibidas con identidad resoluble: las que cuentan como presencia. */
  seen: number;
}

export async function ingestFile(
  pool: pg.Pool,
  region: string,
  content: LeaderboardFile,
): Promise<IngestResult> {
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

  if (entries.length === 0) return { snapshots: 0, redundant: 0, seen: 0 };

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

    //    Y solo entra lo que difiere de la observación anterior del mismo
    //    personaje: sin ese filtro, una publicación entera (5.000 filas) se
    //    escribe porque *otro* jugador del bracket jugó. Medido sobre la
    //    temporada 42, solo el 18% de las filas de cada publicación llevaba algo
    //    nuevo; sobre la 41, ninguna de 647.950 (#53). Lo demás no es un
    //    histórico más denso, es uno más ruidoso, y engorda la única tabla que
    //    no podríamos reconstruir.
    //
    //    Se compara contra la misma fuente y temporada, nunca contra un snapshot
    //    de perfil: sus contadores de partidas no cuentan lo mismo (ADR 0008) y
    //    cruzarlos fabricaría diferencias que nadie jugó. Y contra la observación
    //    *anterior* (`captured_at <`), para que reingerir un archivo ya ingerido
    //    siga siendo idempotente en vez de compararse consigo mismo.
    const result = await client.query<{ received: string; redundant: string; inserted: string }>(
      `with incoming as (
         select * from unnest(
           $1::uuid[], $2::timestamptz[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[],
           $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[]
         ) as t(character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
                rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id)
       ),
       with_previous as (
         select i.*,
                (previous.id is not null
                 and (i.rating, i.matches_played, i.matches_won, i.matches_lost, i.pvp_tier_id)
                     is not distinct from
                     (previous.rating, previous.matches_played, previous.matches_won,
                      previous.matches_lost, previous.pvp_tier_id)) as redundant
           from incoming i
           left join lateral (
             select s.id, s.rating, s.matches_played, s.matches_won, s.matches_lost, s.pvp_tier_id
               from character_snapshots s
              where s.character_id = i.character_id
                and s.bracket = i.bracket
                and s.season_id = i.season_id
                and s.source = 'leaderboard'
                and s.captured_at < i.captured_at
              order by s.captured_at desc
              limit 1
           ) previous on true
       ),
       inserted as (
         insert into character_snapshots
           (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
            rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id)
         select character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
                rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id
           from with_previous
          where not redundant
         on conflict (character_id, bracket, captured_at) do nothing
         returning 1
       )
       select (select count(*) from with_previous)                 as received,
              (select count(*) from with_previous where redundant) as redundant,
              (select count(*) from inserted)                      as inserted`,
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

    // 3) Presencia: le hemos visto en la lista, cambiara algo o no.
    //
    //    Con el filtro de arriba, `character_snapshots` deja de poder responder
    //    a "¿cuándo le vimos por última vez?": solo guarda cambios. Ese proxy no
    //    es decorativo — el ADR 0008 lo conserva para medir con dato delante la
    //    distancia entre "le hemos visto" y "ha jugado", que es el sesgo que #16
    //    vino a quitar—, así que vive aquí, a una fila por personaje y temporada
    //    en vez de una por publicación.
    //
    //    El `where` del update es lo que mantiene idempotente reingerir un
    //    archivo: sin él, cada reingesta sumaría una publicación que nadie hizo.
    await client.query(
      `insert into character_presence
         (character_id, bracket, season_id, first_seen_at, last_seen_at)
       select id, $2, $3, $4::timestamptz, $4::timestamptz from unnest($1::uuid[]) as id
       on conflict (character_id, bracket, season_id) do update set
         first_seen_at = least(character_presence.first_seen_at, excluded.first_seen_at),
         last_seen_at  = excluded.last_seen_at,
         publications  = character_presence.publications + 1
       where excluded.last_seen_at > character_presence.last_seen_at`,
      [rows.map((r) => r.id), content.bracket, content.seasonId, content.fetchedAt],
    );

    await client.query("commit");

    const counts = result.rows[0];
    return {
      snapshots: Number(counts?.inserted ?? 0),
      redundant: Number(counts?.redundant ?? 0),
      seen: Number(counts?.received ?? 0),
    };
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
    let redundant = 0;
    for (const { file, content } of files) {
      const label = parseShuffleBracket(content.bracket)?.label ?? content.bracket;
      const result = await ingestFile(pool, region, content);
      total += result.snapshots;
      redundant += result.redundant;
      console.log(
        `→ ${label} (${file}): ${result.snapshots} snapshots nuevos, ` +
          `${result.redundant} sin cambio respecto a la observación anterior`,
      );
    }

    console.log(
      `\nTotal: ${total} snapshots insertados. ` +
        `${redundant} entradas no traían nada nuevo y no se escribieron (#53).`,
    );
    await printDistribution(pool);
  } finally {
    await pool.end();
  }
}
