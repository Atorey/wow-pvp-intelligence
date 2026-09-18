/**
 * Dataset de desarrollo reproducible (#64, [ADR 0018](../../../../docs/decisions/0018-dataset-de-desarrollo.md)).
 *
 * Hoy no se puede trabajar la UI sin una copia de la Postgres de producción
 * —840.240 filas y credenciales de Blizzard para rellenarla—, así que esto
 * siembra en local una población pequeña que cubre los estados que la web tiene
 * que saber pintar: escalones con confianza `high`, escalones con población
 * suficiente y gear insuficiente, escalones vacíos y dos temporadas conviviendo.
 *
 * Dos decisiones que se ven en el código y conviene no perder de vista:
 *
 * - **Solo escribe observaciones.** `population_segments` y
 *   `aggregate_snapshots` no se siembran: los calcula `refresh-aggregates` al
 *   final, igual que en producción. Sembrarlos a mano dejaría escribir
 *   combinaciones que el pipeline nunca produce —una fila `high` con
 *   `gear_sample = 0`, por ejemplo (#76)— y el fixture enseñaría a la web a
 *   confiar en algo que la realidad no le va a dar.
 * - **Solo corre contra una base local.** El comando escribe población
 *   inventada; `DATABASE_URL` apunta en este repo a la Supabase de producción,
 *   y ahí eso no es un fixture, es contaminar el histórico que el
 *   [ADR 0002](../../../../docs/decisions/0002-modelo-append-only.md) protege.
 *   No hay flag para saltárselo.
 */
import type pg from "pg";
import { getDatabaseUrl, getRegion } from "../config";
import { upsertCharacters, identityKey, type CharacterIdentity } from "@wowpvp/blizzard";
import { createPool } from "../db/pool";
import { insertProfileSnapshot } from "@wowpvp/blizzard";
import { refreshAggregates } from "./refresh-aggregates";
import {
  buildSeedDataset,
  loadItemCatalog,
  summarize,
  CURRENT_SEASON,
  NAMED_CHARACTERS,
  PREVIOUS_SEASON,
  type SeedDataset,
  type SeedObservation,
  type SeedParticipation,
} from "./seed-dataset";

/**
 * Semilla por defecto. Está fijada y no es la hora ni un aleatorio porque el
 * valor de este dataset es que dos personas que lo siembran ven lo mismo: un
 * bug de UI reproducible con "siembra y entra en /eu/sanguino/váldes".
 */
const DEFAULT_SEED = "onerung-dev-1";

/** Filas por INSERT en las cargas masivas. */
const BATCH_SIZE = 1_000;

/**
 * Todo lo que el pipeline escribe, en orden de dependencia inverso.
 *
 * `schema_migrations` no está: el reset vacía datos, no deshace el schema.
 */
const SEEDED_TABLES = [
  "aggregate_snapshots",
  "item_media",
  "segment_coverage",
  "population_segments",
  "character_activity",
  "character_presence",
  "character_snapshot_gear",
  "character_snapshots",
  "character_lookups",
  "leaderboard_fetches",
  "characters",
];

// --- Argumentos ---

export interface Options {
  seed: string;
  /**
   * Vacía las tablas antes de sembrar. Sin esto se suma a lo que hubiera: con
   * la misma semilla son observaciones nuevas de los mismos personajes; con
   * otra, población nueva encima de la anterior.
   */
  reset: boolean;
  /** No encadena `refresh-aggregates`. Para sembrar y agregar por separado. */
  skipAggregates: boolean;
}

export function parseOptions(args: string[]): Options {
  const options: Options = { seed: DEFAULT_SEED, reset: false, skipAggregates: false };

  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === "--reset") {
      options.reset = true;
      continue;
    }
    if (flag === "--skip-aggregates") {
      options.skipAggregates = true;
      continue;
    }
    if (flag !== "--seed") {
      throw new Error(
        `Opción desconocida: ${flag}. Disponibles: --seed, --reset, --skip-aggregates.`,
      );
    }

    const value = args[++i];
    if (!value) throw new Error("--seed necesita un valor: la semilla del generador.");
    options.seed = value;
  }

  return options;
}

// --- Guardarraíl ---

/**
 * Solo se considera local lo que apunta a esta máquina.
 *
 * Falla cerrado: una cadena que no se pueda interpretar cuenta como remota. Es
 * la asimetría correcta —negarse a sembrar una base local cuesta un mensaje de
 * error; sembrar población inventada en producción no tiene vuelta atrás.
 */
export function isLocalDatabase(connectionString: string): boolean {
  let host: string;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return false;
  }
  return ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host);
}

export function assertLocalDatabase(connectionString: string): void {
  if (isLocalDatabase(connectionString)) return;

  let host = "(no se pudo leer el host)";
  try {
    host = new URL(connectionString).hostname;
  } catch {
    /* se queda el texto de arriba: la cadena ni siquiera parsea */
  }

  throw new Error(
    `seed solo puede escribir en una base local y DATABASE_URL apunta a "${host}".\n` +
      `Este comando inventa población: en la base real falsearía los tamaños de muestra ` +
      `sobre los que el producto declara su confianza, y el histórico es append-only.\n` +
      `Levanta una Postgres local, apunta ahí DATABASE_URL y migra:\n` +
      `  DATABASE_URL=postgres://postgres:postgres@localhost:5432/wowpvp npm run db:migrate`,
  );
}

// --- Escritura ---

/**
 * Vacía las tablas de datos. Solo se llega aquí con una base local.
 *
 * `truncate` sobre `character_snapshots` no incumple el ADR 0002: lo que ese
 * ADR protege es el histórico observado, y aquí no hay ninguno — hay lo que
 * sembró la corrida anterior. Sin reset, dos corridas seguidas dejarían dos
 * poblaciones superpuestas y el `n` de cada escalón dejaría de ser el que
 * declara el plan.
 */
export async function resetDatabase(pool: pg.Pool): Promise<void> {
  await pool.query(`truncate table ${SEEDED_TABLES.join(", ")} restart identity cascade`);
}

/**
 * Escribe el dataset entero en una transacción.
 *
 * Reutiliza `upsertCharacters` e `insertProfileSnapshot` en vez de traerse su
 * propio INSERT, y no por ahorrar líneas: si el seed escribiera por su cuenta,
 * un cambio en el modelo podría dejar el camino de producción roto con el test
 * de integración en verde, que es justo el hueco que este issue viene a cerrar.
 */
export async function seedDatabase(
  pool: pg.Pool,
  dataset: SeedDataset,
  region: string,
): Promise<void> {
  const client = await pool.connect();

  try {
    await client.query("begin");

    const identities: CharacterIdentity[] = dataset.identities.map((identity) => ({
      realmSlug: identity.realmSlug,
      nameSlug: identity.nameSlug,
      nameDisplay: identity.nameDisplay,
      faction: identity.faction,
      blizzardCharacterId: identity.blizzardCharacterId,
    }));
    const ids = await upsertCharacters(client, region, identities);

    const idFor = (participation: SeedParticipation): string => {
      const id = ids.get(
        identityKey(participation.identity.realmSlug, participation.identity.nameSlug),
      );
      if (!id) {
        throw new Error(
          `El upsert no devolvió id para ${participation.identity.realmSlug}/${participation.identity.nameSlug}.`,
        );
      }
      return id;
    };

    await insertObservations(client, dataset, idFor);
    await insertPresence(client, dataset, idFor);
    await insertProfiles(client, dataset, idFor);
    await insertItemMedia(client, dataset);

    await client.query("commit");
  } catch (err) {
    await client.query("rollback");
    throw err;
  } finally {
    client.release();
  }
}

/** Filas de leaderboard: rating, puesto y contadores, sin gear. */
async function insertObservations(
  client: pg.PoolClient,
  dataset: SeedDataset,
  idFor: (participation: SeedParticipation) => string,
): Promise<void> {
  interface Row {
    characterId: string;
    participation: SeedParticipation;
    observation: SeedObservation;
  }

  const rows: Row[] = [];
  for (const participation of dataset.participations) {
    if (participation.origin !== "ladder") continue;
    const characterId = idFor(participation);
    for (const observation of participation.observations) {
      rows.push({ characterId, participation, observation });
    }
  }

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await client.query(
      `insert into character_snapshots
         (character_id, captured_at, source, season_id, bracket, class_slug, spec_slug,
          rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id)
       select * from unnest(
         $1::uuid[], $2::timestamptz[], $3::text[], $4::int[], $5::text[], $6::text[], $7::text[],
         $8::int[], $9::int[], $10::int[], $11::int[], $12::int[], $13::int[]
       )
       on conflict (character_id, bracket, captured_at) do nothing`,
      [
        batch.map((row) => row.characterId),
        batch.map((row) => row.observation.capturedAt),
        batch.map(() => "leaderboard"),
        batch.map((row) => row.participation.seasonId),
        batch.map((row) => row.participation.bracket),
        batch.map((row) => row.participation.spec.classSlug),
        batch.map((row) => row.participation.spec.specSlug),
        batch.map((row) => row.observation.rating),
        batch.map((row) => row.observation.ladderRank),
        batch.map((row) => row.observation.matchesPlayed),
        batch.map((row) => row.observation.matchesWon),
        batch.map((row) => row.observation.matchesLost),
        batch.map((row) => row.observation.pvpTierId),
      ],
    );
  }
}

/**
 * Presencia: cuántas veces le hemos visto en la lista.
 *
 * Se escribe aparte de los snapshots porque desde el ADR 0009 son dos números
 * distintos, y un dataset donde coincidieran enseñaría a contar filas para
 * saber cuántas veces hemos visto a alguien — que mide otra cosa.
 */
async function insertPresence(
  client: pg.PoolClient,
  dataset: SeedDataset,
  idFor: (participation: SeedParticipation) => string,
): Promise<void> {
  const withPresence = dataset.participations.filter(
    (participation) => participation.presence !== null,
  );

  for (let i = 0; i < withPresence.length; i += BATCH_SIZE) {
    const batch = withPresence.slice(i, i + BATCH_SIZE);
    await client.query(
      `insert into character_presence
         (character_id, bracket, season_id, first_seen_at, last_seen_at, publications)
       select * from unnest($1::uuid[], $2::text[], $3::int[], $4::timestamptz[], $5::timestamptz[], $6::int[])
       on conflict (character_id, bracket, season_id) do nothing`,
      [
        batch.map(idFor),
        batch.map((participation) => participation.bracket),
        batch.map((participation) => participation.seasonId),
        batch.map((participation) => participation.presence?.firstSeenAt),
        batch.map((participation) => participation.presence?.lastSeenAt),
        batch.map((participation) => participation.presence?.publications),
      ],
    );
  }
}

/** Perfiles completos, por el mismo camino que el muestreo y la búsqueda. */
async function insertProfiles(
  client: pg.PoolClient,
  dataset: SeedDataset,
  idFor: (participation: SeedParticipation) => string,
): Promise<void> {
  for (const participation of dataset.participations) {
    const profile = participation.profile;
    if (!profile) continue;

    await insertProfileSnapshot(client, {
      characterId: idFor(participation),
      capturedAt: profile.capturedAt.toISOString(),
      source: participation.origin === "search" ? "search" : "profile",
      seasonId: participation.seasonId,
      bracket: participation.bracket,
      spec: participation.spec,
      // El rating del perfil es el de su última observación de lista; en los de
      // búsqueda, que no tienen lista, el que trae el propio perfil.
      rating: ratingForProfile(participation),
      matchesPlayed: profile.matchesPlayed,
      matchesWon: profile.matchesWon,
      matchesLost: profile.matchesLost,
      pvpTierId: null,
      averageItemLevel: profile.averageItemLevel,
      equippedItemLevel: profile.equippedItemLevel,
      talentCode: profile.talentLoadoutCode,
      talents: profile.talents,
      heroTree: profile.heroTalentTree,
      gear: profile.gear.map((item) => ({
        slot: item.slot,
        itemId: item.itemId,
        itemName: item.itemName,
        itemLevel: item.itemLevel,
        quality: item.quality,
        enchantmentIds: item.enchantmentIds,
        enchantmentNames: item.enchantmentNames,
        gemItemIds: item.gemItemIds,
        gemItemNames: item.gemItemNames,
        bonusList: [],
      })),
    });
  }
}

/**
 * Catálogo de iconos (#67).
 *
 * Se siembra entero, no solo los items que le tocaron a alguien: `item_media`
 * es un catálogo del juego y no depende de qué repartió el generador. Sembrarlo
 * es lo que hace que en local se vea la fila de gear con icono; sin esto, la
 * única pantalla observable en desarrollo sería la del hueco vacío, que es el
 * caso raro y no el normal.
 *
 * `resolved_at` se fecha contra el `now` de la corrida, como todo lo demás: con
 * la fecha real, un dataset sembrado hace más de 30 días saldría entero como
 * pendiente de revalidar la primera vez que alguien probase el job.
 */
async function insertItemMedia(client: pg.PoolClient, dataset: SeedDataset): Promise<void> {
  const items = [...dataset.itemMedia];
  if (items.length === 0) return;

  await client.query(
    `insert into item_media (item_id, icon_url, resolved_at)
     select * from unnest($1::bigint[], $2::text[], $3::timestamptz[])
     on conflict (item_id) do update
        set icon_url = excluded.icon_url, resolved_at = excluded.resolved_at`,
    [
      items.map(([itemId]) => itemId),
      items.map(([, iconUrl]) => iconUrl),
      items.map(() => dataset.now.toISOString()),
    ],
  );
}

function ratingForProfile(participation: SeedParticipation): number {
  const last = participation.observations[participation.observations.length - 1];
  if (last) return last.rating;

  const named = NAMED_CHARACTERS.find(
    (character) =>
      character.realmSlug === participation.identity.realmSlug &&
      character.nameDisplay.toLowerCase() === participation.identity.nameSlug,
  );
  return named?.rating ?? 0;
}

// --- Salida ---

function printPlan(dataset: SeedDataset): void {
  const summary = summarize(dataset);

  console.log(
    `${summary.identities} personajes, ${summary.participations} participaciones, ` +
      `${summary.snapshots} snapshots y ${summary.gearRows} filas de gear.`,
  );
  const withIcon = [...dataset.itemMedia.values()].filter((icon) => icon !== null).length;
  console.log(
    `Catálogo de iconos: ${withIcon} de ${dataset.itemMedia.size} items con URL resuelta (#67).`,
  );
  const seasons = [...summary.bySeason]
    .sort(([a], [b]) => b - a)
    .map(([season, count]) => `temporada ${season}: ${count}`)
    .join(" · ");
  console.log(`${seasons}\n`);

  console.log("Escalones sembrados (la confianza la decidirá el agregado, no el plan):");
  for (const { plan, population, profiles } of summary.byPlan) {
    console.log(
      `  ${plan.spec.padEnd(19)} ${String(plan.segmentMin).padStart(4)}-${plan.segmentMin + 200}  ` +
        `n=${String(population).padStart(3)} · ${String(profiles).padStart(3)} con perfil`,
    );
    console.log(`  ${" ".repeat(19)} └─ ${plan.covers}`);
  }

  console.log("\nPersonajes con nombre fijo (los que se pueden teclear en una URL):");
  for (const character of NAMED_CHARACTERS) {
    console.log(`  ${character.realmSlug}/${character.nameDisplay.toLowerCase()}`);
    console.log(`  ${" ".repeat(2)}└─ ${character.covers}`);
  }
}

// --- Job ---

export async function seed(args: string[]): Promise<void> {
  const options = parseOptions(args);
  const connectionString = getDatabaseUrl();
  assertLocalDatabase(connectionString);

  const region = getRegion();
  const now = new Date();

  console.log("Dataset de desarrollo (#64)\n");
  console.log(
    `Región ${region.toUpperCase()} · semilla "${options.seed}" · ` +
      `temporadas ${PREVIOUS_SEASON} (terminada) y ${CURRENT_SEASON} (vigente)`,
  );
  console.log(`Fechado contra ${now.toISOString()}: todo cae dentro de la ventana de actividad.\n`);

  const dataset = buildSeedDataset({ now, seed: options.seed, catalog: loadItemCatalog() });
  printPlan(dataset);

  const pool = createPool(connectionString);
  try {
    if (options.reset) {
      await resetDatabase(pool);
      console.log(`\n${SEEDED_TABLES.length} tablas vaciadas.`);
    }

    console.log("\nSembrando…");
    await seedDatabase(pool, dataset, region);
    console.log("Población escrita.");

    if (options.skipAggregates) {
      console.log(
        "\n--skip-aggregates: no hay `population_segments` todavía. " +
          "Para que la web tenga qué leer: npm run pipeline -- refresh-aggregates",
      );
      return;
    }

    // Los agregados los calcula el job real sobre lo recién sembrado. Es la
    // diferencia entre un fixture que prueba la web y uno que además prueba
    // que el pipeline sabe producir lo que la web espera.
    console.log("\n--- Agregados (el job de producción, sobre lo sembrado) ---\n");
    await refreshAggregates([], pool);
  } finally {
    await pool.end();
  }
}
