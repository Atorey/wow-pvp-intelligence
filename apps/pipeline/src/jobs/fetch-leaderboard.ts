import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { nameSlug, shuffleBracketId, unknownShuffleBrackets, type SpecEntry } from "@wowpvp/core";
import { BlizzardClient, blizzardUsage } from "../blizzard/client";
import { formatUsage } from "../blizzard/request-queue";
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
  /** Huella del payload de Blizzard, no del archivo: ver `hashLeaderboard`. */
  contentHash: string;
  /**
   * Huella de la población publicada: ver `hashPopulation`. Es la que decide si
   * se ingiere. Opcional porque los archivos escritos antes de #53 no la traen,
   * y un archivo viejo en `data/leaderboard` no debe romper una reingesta.
   */
  populationHash?: string;
  leaderboard: unknown;
}

/**
 * Huella del contenido publicado por Blizzard, para saber si una descarga trae
 * algo nuevo. Se calcula sobre el payload y no sobre el archivo porque el
 * archivo incluye `fetchedAt`: dos descargas idénticas darían hashes distintos
 * y todo el mecanismo dejaría de detectar nada.
 *
 * Basta con `JSON.stringify` sin canonicalizar claves: el orden viene del mismo
 * productor en ambas descargas, así que es estable en la práctica. Un falso
 * "cambió" por reordenación solo costaría una ingesta de más, que el índice
 * único de snapshots absorbe.
 */
export function hashLeaderboard(payload: unknown): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

/**
 * Lo que de una entrada del leaderboard es dato de población. El resto —el
 * `rank`, el envoltorio, el orden del array— es derivado o accesorio, y no
 * describe a nadie.
 */
interface PopulationEntry {
  character?: { name?: string; id?: number; realm?: { slug?: string } };
  rating?: number;
  season_match_statistics?: { played?: number; won?: number; lost?: number };
  tier?: { id?: number };
}

/**
 * Identidad de una entrada para ordenar la huella. Se prefiere el id de
 * Blizzard, que sobrevive a renombres y transferencias; sin él, (reino, nombre).
 * Los dos espacios van prefijados para que un id 123 no pueda colisionar con un
 * personaje que se llame así.
 */
function populationKey(entry: PopulationEntry): string {
  const id = entry.character?.id;
  if (typeof id === "number") return `id:${id}`;
  return `n:${entry.character?.realm?.slug ?? ""}|${nameSlug(entry.character?.name ?? "")}`;
}

/**
 * Huella de la población publicada: quiénes están y con qué rating, partidas y
 * tier. Es la que decide si se ingiere.
 *
 * `hashLeaderboard` no sirve para eso, y no por el `rank`: medido sobre la
 * temporada 41 en EU, de 148 transiciones entre publicaciones consecutivas 36
 * movían solo el rank, 49 eran altas o bajas —población de verdad— y **96 no
 * cambiaban nada de lo que guardamos**. El payload se mueve por campos que ni
 * siquiera ingerimos. Por eso esta huella se calcula sobre la proyección exacta
 * de lo que acaba en `character_snapshots`: así es inmune por construcción a
 * cualquier cosa que Blizzard cambie fuera de ahí, en vez de ir excluyendo
 * campos a medida que los descubrimos.
 *
 * Se ordena por identidad y no se confía en el orden recibido, que viene por
 * rank: si no, una sola alta en el corte desplazaría a todos los de abajo y
 * volveríamos a tener una huella que se mueve sin que cambie nadie.
 *
 * Se descartan las entradas sin nombre o sin reino porque son las mismas que
 * `ingest-leaderboard` descarta: la huella tiene que hablar de lo que se
 * ingiere, no de lo que se recibe.
 */
export function hashPopulation(payload: unknown): string {
  const entries = ((payload as { entries?: PopulationEntry[] })?.entries ?? []).filter(
    (e) => e?.character?.name && e?.character?.realm?.slug,
  );

  const projection = entries
    .map((e) => [
      populationKey(e),
      e.rating ?? null,
      e.season_match_statistics?.played ?? null,
      e.season_match_statistics?.won ?? null,
      e.season_match_statistics?.lost ?? null,
      e.tier?.id ?? null,
    ])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));

  return crypto.createHash("sha256").update(JSON.stringify(projection)).digest("hex");
}

/** Una spec descargada. `file` es null cuando la descarga falló o vino vacía. */
export interface FetchedLeaderboard {
  spec: string;
  bracket: string;
  entries: number;
  topRating: number | null;
  cutoffRating: number | null;
  warning: string | null;
  file: { path: string; hash: string; populationHash: string; content: LeaderboardFile } | null;
}

export interface LeaderboardBatch {
  region: string;
  seasonId: number;
  fetchedAt: string;
  results: FetchedLeaderboard[];
  /**
   * Brackets de shuffle publicados que el catálogo no reconoce. `null` cuando
   * no se pudo comprobar (rule 5: null es "no disponible", no "no hay ninguno"),
   * que es distinto de una lista vacía y no debe leerse como "todo en orden".
   */
  unknownBrackets: string[] | null;
}

interface LeaderboardIndex {
  leaderboards?: { name?: string }[];
}

/**
 * Contraste entre lo que Blizzard publica y lo que el catálogo sabe mapear.
 *
 * Cuesta una petición por corrida y no cambia lo que se ingiere: solo avisa. Es
 * el seguro contra el punto ciego de tener el catálogo estático — una spec nueva
 * de un parche se ingiere en cero sitios y sin ruido, y lo normal es enterarse
 * meses después. Si el índice no responde se devuelve null: un diagnóstico que
 * falla no debe tumbar la descarga, pero tampoco puede pasar por "no hay nada
 * desconocido".
 */
async function findUnknownBrackets(
  client: BlizzardClient,
  seasonId: number,
): Promise<string[] | null> {
  const res = await client.tryGet<LeaderboardIndex>(
    `/data/wow/pvp-season/${seasonId}/pvp-leaderboard/index`,
    "dynamic",
  );
  if (!res.ok || !res.data) return null;

  const names = (res.data.leaderboards ?? [])
    .map((l) => l.name)
    .filter((name): name is string => typeof name === "string");
  return unknownShuffleBrackets(names);
}

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

/** Nombre del archivo de una descarga. El sufijo temporal lo usa la retención. */
export function leaderboardFileName(bracket: string, seasonId: number, fetchedAt: string): string {
  const stamp = fetchedAt.replace(/[-:]/g, "").replace(/\..+$/, "");
  return `${bracket}-season${seasonId}-${stamp}.json`;
}

async function fetchSpec(
  client: BlizzardClient,
  spec: SpecEntry,
  seasonId: number,
  fetchedAt: string,
): Promise<FetchedLeaderboard> {
  const bracket = shuffleBracketId(spec);
  const res = await client.tryGet<{ entries?: { rating?: number }[] }>(
    `/data/wow/pvp-season/${seasonId}/pvp-leaderboard/${bracket}`,
    "dynamic",
  );

  const result: FetchedLeaderboard = {
    spec: spec.label,
    bracket,
    entries: 0,
    topRating: null,
    cutoffRating: null,
    warning: null,
    file: null,
  };

  if (!res.ok || !res.data) {
    result.warning = `HTTP ${res.status} — ${res.error?.slice(0, 200) ?? "sin cuerpo"}`;
    return result;
  }

  const entries = res.data.entries ?? [];
  result.entries = entries.length;

  if (entries.length === 0) {
    // Fallo documentado en el foro oficial: el endpoint responde 200 con 0
    // entradas para ciertos brackets de shuffle según temporada/namespace.
    result.warning =
      "0 entradas con respuesta OK. Es un fallo conocido para algunos brackets de Solo Shuffle: " +
      "no asumas que la spec no se juega, reintenta más tarde antes de descartarla.";
  } else {
    const ratings = entries.map((e) => e.rating).filter((r): r is number => typeof r === "number");
    result.topRating = Math.max(...ratings);
    result.cutoffRating = Math.min(...ratings);
  }

  const hash = hashLeaderboard(res.data);
  const populationHash = hashPopulation(res.data);
  const content: LeaderboardFile = {
    fetchedAt,
    region: client.region,
    seasonId,
    bracket,
    contentHash: hash,
    populationHash,
    leaderboard: res.data,
  };

  fs.mkdirSync(LEADERBOARD_DIR, { recursive: true });
  const filePath = path.join(LEADERBOARD_DIR, leaderboardFileName(bracket, seasonId, fetchedAt));
  fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
  result.file = { path: filePath, hash, populationHash, content };

  return result;
}

/**
 * Descarga el leaderboard de las specs activas y devuelve lo descargado. Los
 * jobs que la usan deciden qué hacer con ello; aquí no se imprime nada, para
 * que el job programado (`refresh-leaderboard`) no tenga que leer la salida por
 * consola para saber qué pasó.
 */
export async function fetchLeaderboardBatch(): Promise<LeaderboardBatch> {
  // Batch: prioridad intermedia (§28). Puede llegar tarde sin que nadie lo note,
  // pero no debe quedarse detrás del recomputo de agregados, que sí puede.
  const client = new BlizzardClient({ priority: "batch" });
  const seasonId = await resolveCurrentSeasonId(client);
  const fetchedAt = new Date().toISOString();

  const unknownBrackets = await findUnknownBrackets(client, seasonId);

  const results: FetchedLeaderboard[] = [];
  for (const spec of SPECS_TO_INGEST) {
    results.push(await fetchSpec(client, spec, seasonId, fetchedAt));
  }

  return { region: client.region, seasonId, fetchedAt, results, unknownBrackets };
}

/** Informe legible de una tanda de descarga. Lo comparten el fetch manual y el job programado. */
export function printBatch(batch: LeaderboardBatch): void {
  console.log("\n=== LEADERBOARD SOLO SHUFFLE ===\n");
  for (const s of batch.results) {
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

  if (batch.unknownBrackets === null) {
    console.log("No se pudo leer el índice de leaderboards: sin comprobar si hay specs nuevas.");
  } else if (batch.unknownBrackets.length > 0) {
    console.log(
      `⚠️  Blizzard publica ${batch.unknownBrackets.length} bracket(s) de shuffle que el ` +
        `catálogo no conoce: ${batch.unknownBrackets.join(", ")}. No se están ingiriendo — ` +
        `añádelos a ALL_SPECS en @wowpvp/core.`,
    );
  }

  const total = batch.results.reduce((acc, s) => acc + s.entries, 0);
  console.log(`Total descargado (crudo, sin deduplicar): ${total}`);
  console.log(`Cuota: ${formatUsage(blizzardUsage())}`);
}

export async function fetchLeaderboards(): Promise<void> {
  console.log(`Descargando leaderboard de Solo Shuffle para ${SPECS_TO_INGEST.length} specs...`);

  const batch = await fetchLeaderboardBatch();
  console.log(`Región: ${batch.region.toUpperCase()} — temporada actual: ${batch.seasonId}`);

  printBatch(batch);
  console.log(`Dataset en: ${LEADERBOARD_DIR}`);
  console.log(`\nSiguiente paso: npm run pipeline -- ingest-leaderboard`);
}
