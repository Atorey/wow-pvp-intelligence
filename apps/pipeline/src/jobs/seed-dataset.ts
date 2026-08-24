/**
 * De qué está hecha la población de desarrollo que siembra `seed` (#64).
 *
 * Vive aparte del comando y sin dependencias de red ni de BD, igual que
 * `profile-mapping`: aquí están las decisiones —cuánta gente hay en cada
 * escalón, cuánta trae perfil, qué items lleva— y en `seed.ts` solo queda la
 * escritura. Así el dataset se puede probar entero sin levantar Postgres, que
 * es lo que permite afirmar en un test que hay un segmento con `high` y otro
 * con muestra insuficiente en vez de comprobarlo a ojo tras sembrar.
 *
 * **Nada de esto son tablas derivadas.** El seed escribe observaciones
 * (`characters`, `character_snapshots`, gear y presencia) y deja que
 * `refresh-aggregates` calcule `population_segments` y `aggregate_snapshots`
 * como en producción ([ADR 0018](../../../../docs/decisions/0018-dataset-de-desarrollo.md)).
 * Por eso aquí se declara **población**, no confianza: el `gear_sample` de una
 * fila sale de contar perfiles, y si el plan de abajo pide 9 perfiles, la
 * confianza de esa comparación saldrá `insufficient` porque lo es.
 *
 * **El dataset es deliberadamente más generoso que la producción de hoy.** En
 * la temporada 42 real, medida el 22 de agosto de 2026, no hay un solo segmento
 * capaz de pintar un Player Gap ([§13 de findings](../../../../docs/sprint-0-findings.md)).
 * Un fixture calcado de eso no dejaría desarrollar la pantalla que es la razón
 * de ser del MVP; uno que solo tuviera segmentos llenos dejaría desarrollar una
 * web que no sobrevive al primer día contra datos reales. Por eso el plan
 * incluye las dos cosas, y por eso cada fila dice qué estado de pantalla cubre.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { requireSpecSlug, shuffleBracketId, specSlug, type SpecEntry } from "@wowpvp/core";
import { seededRandom } from "../sampling";

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/**
 * Temporada vigente y la que acaba de terminar (§10 de findings).
 *
 * Conviven a propósito: el corte de temporada real cayó en mitad de la ventana
 * de actividad, así que `refresh-aggregates` avisa de que hay dos y agrega solo
 * la vigente. Sembrar una sola temporada escondería ese aviso y, con él, la
 * única situación en la que la web tiene que decidir de qué temporada habla.
 */
export const CURRENT_SEASON = 42;
export const PREVIOUS_SEASON = 41;

/** Hace cuántos días terminó la 41 y empezó la 42, contados desde `now`. */
const SEASON_CHANGE_DAYS_AGO = 5;

/** Catálogo de items: `apps/pipeline/config/seed-items.eu.json`. */
const ITEMS_FILE = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "config",
  "seed-items.eu.json",
);

// --- Catálogo de items ---

/** Un item observado en un slot, con la frecuencia con la que se observó. */
export interface CatalogItem {
  itemId: number;
  name: string;
  quality: string;
  itemLevel: number;
  /** Veces que se vio en ese slot. Es la probabilidad relativa de repartirlo. */
  weight: number;
}

/** slug de spec → slot → items observados en ese slot, de más a menos frecuente. */
export type ItemCatalog = ReadonlyMap<string, ReadonlyMap<string, readonly CatalogItem[]>>;

/**
 * Carga el catálogo del disco en vez de importarlo como módulo, con el mismo
 * criterio que `validate-endpoints` con su lista de personajes: es dato de
 * configuración revisable en el diff, no parte del grafo de tipos.
 */
export function loadItemCatalog(file: string = ITEMS_FILE): ItemCatalog {
  const raw = JSON.parse(fs.readFileSync(file, "utf-8")) as {
    specs?: Record<string, Record<string, CatalogItem[]>>;
  };

  const catalog = new Map<string, ReadonlyMap<string, readonly CatalogItem[]>>();
  for (const [slug, slots] of Object.entries(raw.specs ?? {})) {
    // Falla al arrancar si el catálogo trae una spec que el catálogo canónico
    // no conoce: un slug mal escrito ahí sembraría un bracket inexistente.
    requireSpecSlug(slug);
    catalog.set(slug, new Map(Object.entries(slots)));
  }

  if (catalog.size === 0) {
    throw new Error(`El catálogo de items de ${file} está vacío o no tiene la clave "specs".`);
  }
  return catalog;
}

// --- El plan: qué escalones existen y qué estado de pantalla cubre cada uno ---

export interface SegmentPlan {
  /** Slug canónico de spec, el mismo que la URL y que `--specs` (ADR 0016). */
  spec: string;
  /** Rating de entrada del escalón: 1800 es el segmento "1800-2000". */
  segmentMin: number;
  /** Personajes con fila de leaderboard. Acaba siendo el `sample_size`. */
  population: number;
  /** Cuántos de ellos traen además perfil completo. Acaba siendo el `gear_sample`. */
  profiles: number;
  /** Fracción de esos perfiles que trae `talent_loadout_code` (§30, parche 11.2). */
  talentCoverage: number;
  /** Qué estado de pantalla existe gracias a esta fila. Se imprime al sembrar. */
  covers: string;
}

/**
 * Los escalones de la temporada vigente.
 *
 * Los tres primeros de `frost-mage` son la escalera del Player Gap: quien está
 * en 1800-2000 se compara con 2000-2200, y los dos tienen perfiles de sobra
 * para que la comparación exista. Los dos últimos son los estados que la web
 * tiene que saber pintar y que hoy son mayoría en producción.
 */
export const SEGMENT_PLAN: readonly SegmentPlan[] = [
  {
    spec: "frost-mage",
    segmentMin: 1600,
    population: 64,
    profiles: 41,
    talentCoverage: 0.7,
    covers: "comparación con confianza `medium` (n de gear entre 30 y 100)",
  },
  {
    spec: "frost-mage",
    segmentMin: 1800,
    population: 150,
    profiles: 118,
    talentCoverage: 0.7,
    covers: "confianza `high` en población y en gear: el segmento del sujeto del Player Gap",
  },
  {
    spec: "frost-mage",
    segmentMin: 2000,
    population: 132,
    profiles: 104,
    talentCoverage: 0.7,
    covers: "confianza `high`: el segmento objetivo contra el que se compara el sujeto",
  },
  {
    spec: "frost-mage",
    segmentMin: 2200,
    population: 48,
    profiles: 9,
    talentCoverage: 0.7,
    covers: "población suficiente y base de comparación insuficiente a la vez (#76)",
  },
  {
    spec: "frost-mage",
    segmentMin: 2400,
    population: 11,
    profiles: 0,
    talentCoverage: 0,
    covers: "muestra insuficiente en todo: el estado vacío del brief (§1.5)",
  },
  {
    spec: "restoration-shaman",
    segmentMin: 1800,
    population: 96,
    profiles: 0,
    talentCoverage: 0,
    covers: "distribución de población sin un solo `adoption_rate`: la producción de hoy",
  },
  {
    spec: "restoration-shaman",
    segmentMin: 2000,
    population: 37,
    profiles: 0,
    talentCoverage: 0,
    covers: "ídem, con población justo por encima del umbral",
  },
  {
    spec: "fury-warrior",
    segmentMin: 1600,
    population: 23,
    profiles: 7,
    talentCoverage: 0,
    covers: "spec entera fuera de cobertura (#58) y clase sin `talent_loadout_code`",
  },
];

/** Personajes de la temporada 41 que ya no juegan la 42: histórico y nada más. */
const PREVIOUS_SEASON_POPULATION = 45;

/** De los de 1800-2000 de la 42, cuántos venían ya jugando la 41. */
const RETURNING_FROM_PREVIOUS_SEASON = 15;

// --- Personajes con nombre fijo ---

/**
 * Los que se escriben en la documentación y se tecleaban en una URL.
 *
 * Existen porque un dataset generado no se puede citar: para desarrollar la
 * página de perfil hace falta poder escribir `/eu/sanguino/váldes` y saber qué
 * va a salir. Cada uno está aquí por un caso concreto, no por decorar.
 *
 * Los nombres son inventados; los `realm_slug` son reales, incluido uno con
 * acento —los de Blizzard los llevan (ADR 0017)— y el grupo de Magtheridon
 * comparte `name_fold` sin ser la misma persona, que es justo lo que impide
 * plegar la identidad.
 */
export interface NamedCharacter {
  realmSlug: string;
  /** Nombre tal cual lo devolvería Blizzard. El slug se deriva en minúsculas. */
  nameDisplay: string;
  spec: string;
  segmentMin: number;
  /** Rating exacto, para que la URL de su Player Gap sea siempre la misma. */
  rating: number;
  /** Si trae perfil completo (gear). */
  profile: boolean;
  /** Si ese perfil trae `talent_loadout_code`. */
  talents: boolean;
  /** 'ladder' = está en el leaderboard; 'search' = solo existe porque alguien lo buscó. */
  origin: "ladder" | "search";
  /** Si además tiene histórico en la temporada 41. */
  previousSeason: boolean;
  /** Una sola observación: nunca le hemos visto subir el contador (`first-seen`). */
  singleObservation: boolean;
  covers: string;
}

export const NAMED_CHARACTERS: readonly NamedCharacter[] = [
  {
    realmSlug: "sanguino",
    nameDisplay: "Váldes",
    spec: "frost-mage",
    segmentMin: 1800,
    rating: 1893,
    profile: true,
    talents: true,
    origin: "ladder",
    previousSeason: true,
    singleObservation: false,
    covers: "el sujeto del Player Gap: perfil completo, talentos e histórico en dos temporadas",
  },
  {
    realmSlug: "magtheridon",
    nameDisplay: "Nébulosa",
    spec: "frost-mage",
    segmentMin: 2000,
    rating: 2104,
    profile: true,
    talents: true,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "tres personajes distintos que pliegan al mismo `name_fold` (ADR 0017)",
  },
  {
    realmSlug: "magtheridon",
    nameDisplay: "Nebulosa",
    spec: "frost-mage",
    segmentMin: 1800,
    rating: 1846,
    profile: true,
    talents: false,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "ídem: buscar «nebulosa» tiene que devolver varios, nunca fundirlos",
  },
  {
    realmSlug: "magtheridon",
    nameDisplay: "Nebulósa",
    spec: "restoration-shaman",
    segmentMin: 1800,
    rating: 1912,
    profile: false,
    talents: false,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "ídem, y además en otra spec: el mismo plegado cruza brackets",
  },
  {
    realmSlug: "confrérie-du-thorium",
    nameDisplay: "Ysëlde",
    spec: "restoration-shaman",
    segmentMin: 2000,
    rating: 2033,
    profile: false,
    talents: false,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "reino con acento en el propio slug, que también es URL (ADR 0017)",
  },
  {
    realmSlug: "dun-modr",
    nameDisplay: "Tormundo",
    spec: "frost-mage",
    segmentMin: 2000,
    rating: 2168,
    profile: true,
    talents: false,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "perfil completo con `talent_loadout_code` a null: no disponible, no «sin talentos»",
  },
  {
    realmSlug: "aegwynn",
    nameDisplay: "Perenor",
    spec: "frost-mage",
    segmentMin: 1800,
    rating: 1955,
    profile: true,
    talents: true,
    origin: "ladder",
    previousSeason: false,
    singleObservation: true,
    covers: "una sola observación: actividad por `first-seen`, sin subida vista del contador",
  },
  {
    realmSlug: "ravencrest",
    nameDisplay: "Korthal",
    spec: "fury-warrior",
    segmentMin: 1600,
    rating: 1704,
    profile: true,
    talents: false,
    origin: "ladder",
    previousSeason: false,
    singleObservation: false,
    covers: "spec fuera de cobertura: hay perfil, pero el segmento nunca llega a comparación",
  },
  {
    realmSlug: "kazzak",
    nameDisplay: "Mirelia",
    spec: "frost-mage",
    segmentMin: 1600,
    rating: 1662,
    profile: true,
    talents: true,
    origin: "search",
    previousSeason: false,
    singleObservation: false,
    covers: "entró por búsqueda dentro de un segmento poblado: suma a `excluded_search`",
  },
  {
    realmSlug: "kazzak",
    nameDisplay: "Orvath",
    spec: "frost-mage",
    segmentMin: 1600,
    rating: 1738,
    profile: true,
    talents: true,
    origin: "search",
    previousSeason: false,
    singleObservation: false,
    covers: "ídem, para que ese contador no sea 1 y pueda leerse como lo que es",
  },
  {
    realmSlug: "tarren-mill",
    nameDisplay: "Sildrath",
    spec: "frost-mage",
    segmentMin: 1400,
    rating: 1451,
    profile: true,
    talents: true,
    origin: "search",
    previousSeason: false,
    singleObservation: false,
    covers: "por debajo del corte del leaderboard: existe, y aun así no sale en ningún agregado",
  },
];

// --- Formas del dataset ---

/** Una identidad de `characters`. `name_fold` no viaja: lo deriva el upsert. */
export interface SeedIdentity {
  realmSlug: string;
  nameSlug: string;
  nameDisplay: string;
  faction: string | null;
  blizzardCharacterId: number;
}

/** Un item equipado en un snapshot de perfil. */
export interface SeedGearItem {
  slot: string;
  itemId: number;
  itemName: string;
  itemLevel: number;
  quality: string;
}

/** Una observación de leaderboard: lo que trae la lista, sin gear. */
export interface SeedObservation {
  capturedAt: Date;
  rating: number;
  ladderRank: number | null;
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  /** null por debajo de 1800: la muestra de Sprint 0 no observó tiers ahí (regla 5). */
  pvpTierId: number | null;
}

/** El perfil completo: lo que cuesta cuota y lo único que aporta gear. */
export interface SeedProfile {
  capturedAt: Date;
  equippedItemLevel: number;
  averageItemLevel: number;
  talentLoadoutCode: string | null;
  /**
   * Sistemáticamente menor que el del leaderboard, como en los 595 casos
   * medidos: los dos contadores no cuentan lo mismo y restarlos fabricaría
   * actividad que nadie jugó (ADR 0008).
   */
  matchesPlayed: number;
  matchesWon: number;
  matchesLost: number;
  gear: SeedGearItem[];
}

/** Cuántas veces le hemos visto en la lista, que no es cuántas veces cambió. */
export interface SeedPresence {
  firstSeenAt: Date;
  lastSeenAt: Date;
  publications: number;
}

/** La participación de un personaje en una temporada y un bracket. */
export interface SeedParticipation {
  identity: SeedIdentity;
  seasonId: number;
  spec: SpecEntry;
  bracket: string;
  /** 'ladder' escribe snapshots de leaderboard; 'search', uno con `source='search'`. */
  origin: "ladder" | "search";
  observations: SeedObservation[];
  profile: SeedProfile | null;
  /** null en los de búsqueda: nunca estuvieron en la lista, así que no hay presencia. */
  presence: SeedPresence | null;
  /** Solo para el resumen del comando; no se persiste. */
  covers: string | null;
}

export interface SeedDataset {
  /** El instante contra el que se fechó todo. Las fechas son relativas a él. */
  now: Date;
  seed: string;
  identities: SeedIdentity[];
  participations: SeedParticipation[];
}

// --- Generación ---

/**
 * Sílabas para los nombres generados.
 *
 * Inventados a propósito: un dataset con nombres reales sería población real de
 * Blizzard viviendo fuera de la ventana de revalidación de 30 días del
 * [ADR 0015](../../../../docs/decisions/0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md),
 * y en una base de desarrollo nadie la revalida. Los item_id sí son reales:
 * son catálogo del juego, no datos de una persona.
 */
const NAME_HEADS = [
  "thal",
  "brae",
  "kor",
  "syl",
  "mor",
  "vel",
  "dra",
  "eth",
  "gar",
  "lun",
  "nyx",
  "ryn",
  "tor",
  "ael",
  "fen",
  "zar",
  "ilm",
  "ovh",
];

const NAME_TAILS = [
  "dris",
  "mir",
  "wen",
  "dor",
  "kas",
  "lyn",
  "thar",
  "rion",
  "vek",
  "nara",
  "sil",
  "goth",
  "une",
  "zel",
  "brand",
  "eska",
];

/** Reinos reales de EU, con acentos donde los llevan. */
const REALMS = [
  "aegwynn",
  "sanguino",
  "ravencrest",
  "dun-modr",
  "tarren-mill",
  "kazzak",
  "magtheridon",
  "confrérie-du-thorium",
  "twisting-nether",
  "draenor",
  "silvermoon",
  "outland",
];

const FACTIONS: readonly (string | null)[] = ["ALLIANCE", "HORDE", "ALLIANCE", "HORDE", null];

/**
 * Tiers observados en la muestra de Sprint 0, por tramo de rating.
 *
 * Por debajo de 1800 no hay observación: aquel muestreo solo bajó los buckets
 * de 1800 y 2000, así que ahí se deja null. Inventar un id por continuidad
 * sería fabricar dato del juego para que una columna no quede vacía, y null ya
 * significa exactamente lo que pasa: no disponible (regla 5).
 */
const OBSERVED_TIERS: readonly { minRating: number; tierId: number }[] = [
  { minRating: 2300, tierId: 303 },
  { minRating: 2100, tierId: 304 },
  { minRating: 1950, tierId: 305 },
  { minRating: 1800, tierId: 306 },
];

function tierFor(rating: number): number | null {
  return OBSERVED_TIERS.find((tier) => rating >= tier.minRating)?.tierId ?? null;
}

/**
 * Cuánto se inclina el reparto de items hacia el item level alto según sube el
 * escalón.
 *
 * Sin esta inclinación, dos segmentos consecutivos tendrían la misma
 * distribución de equipo y ninguna diferencia pasaría `isDiscriminative()`: el
 * Player Gap saldría vacío en un dataset lleno, que es el peor fixture posible
 * —parece que funciona y no enseña nada—. El tope existe porque un tilt sin
 * freno convierte los escalones altos en monocultivo de un solo item.
 */
const ILVL_TILT_BASE = 2.2;
const MAX_TILT = 2.5;

function tiltFor(segmentMin: number): number {
  return Math.min((segmentMin - 1600) / 200, MAX_TILT);
}

function pickItem(
  items: readonly CatalogItem[],
  floorLevel: number,
  tilt: number,
  random: () => number,
): CatalogItem {
  const weights = items.map(
    (item) => item.weight * Math.pow(ILVL_TILT_BASE, (tilt * (item.itemLevel - floorLevel)) / 20),
  );
  const total = weights.reduce((sum, weight) => sum + weight, 0);

  let cursor = random() * total;
  for (let i = 0; i < items.length; i++) {
    cursor -= weights[i] as number;
    if (cursor <= 0) return items[i] as CatalogItem;
  }
  return items[items.length - 1] as CatalogItem;
}

/** Slots que no se comparan y que aquí solo existen para que el equipo sea completo. */
const COSMETIC_SLOTS = ["TABARD", "SHIRT"];

function buildGear(
  slots: ReadonlyMap<string, readonly CatalogItem[]>,
  segmentMin: number,
  random: () => number,
): SeedGearItem[] {
  const tilt = tiltFor(segmentMin);
  const gear: SeedGearItem[] = [];

  for (const [slot, items] of [...slots].sort(([a], [b]) => a.localeCompare(b))) {
    if (items.length === 0) continue;
    const floorLevel = Math.min(...items.map((item) => item.itemLevel));
    const item = pickItem(items, floorLevel, tilt, random);
    gear.push({
      slot,
      itemId: item.itemId,
      itemName: item.name,
      itemLevel: item.itemLevel,
      quality: item.quality,
    });
  }

  return gear;
}

/** El equipado es la media de lo que lleva puesto, sin contar lo cosmético. */
function equippedLevel(gear: readonly SeedGearItem[]): number {
  const levels = gear
    .filter((item) => !COSMETIC_SLOTS.includes(item.slot))
    .map((item) => item.itemLevel);
  if (levels.length === 0) return 0;
  return Math.round(levels.reduce((sum, level) => sum + level, 0) / levels.length);
}

/**
 * Códigos de talentos casi todos distintos, como los de verdad.
 *
 * En los 98 perfiles de Sprint 0 con código había 85 códigos distintos: no hay
 * señal comparable, y por eso el MVP sale sin la categoría de talentos (§8.2 de
 * findings). Un seed que repartiera cuatro códigos entre cien personajes daría
 * una señal que en producción no existe, y alguien construiría la pantalla que
 * la enseña. Se repite alguno para que `aggregate_snapshots` tenga también
 * filas de `talent-code` con más de un usuario, que es lo que hay que saber
 * pintar.
 */
const SHARED_TALENT_CODES = [
  "CkEAq6Gv4dPBTvsPLR2vBaC5FRk5FRUJRSSKJhkkkkkQSSKJRSSKJRSSSSCA",
  "CIEAyBvfWjHRRhGXCFRkkQSSKJRSSKJRSSSSSSSSCAAAAAAAAAAAAAAAAAAA",
  "CkEAq6Gv4dPBTvsPLR2vBaCJRSSKJRSSKJRSSSSCAAAAAAAAAAAAAAAAAAAA",
];

const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function talentCode(random: () => number): string {
  if (random() < 0.15) {
    return SHARED_TALENT_CODES[Math.floor(random() * SHARED_TALENT_CODES.length)] as string;
  }
  let code = "C";
  for (let i = 0; i < 59; i++) {
    code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)] as string;
  }
  return code;
}

/** Rating dentro del escalón, más denso abajo que arriba, como la población real. */
function ratingIn(segmentMin: number, random: () => number): number {
  return segmentMin + Math.floor(Math.pow(random(), 1.35) * 199);
}

/** Partidas de la temporada: más arriba, más jugadas. Ganadas alrededor del 50%. */
function matches(
  segmentMin: number,
  random: () => number,
): { played: number; won: number; lost: number } {
  const played = 40 + Math.floor(random() * 160) + Math.floor((segmentMin - 1600) / 200) * 25;
  const won = Math.round(played * (0.46 + random() * 0.12));
  return { played, won, lost: played - won };
}

/** Reduce un contador de leaderboard al que daría el perfil (ADR 0008). */
function asProfileCounter(played: number, random: () => number): number {
  return Math.max(1, Math.round(played * (0.78 + random() * 0.12)));
}

interface NameFactory {
  /** Un nombre nuevo, único dentro de su reino. */
  next(realmSlug: string): { nameSlug: string; nameDisplay: string };
  /** Reserva un nombre fijo para que el generador no lo repita. */
  reserve(realmSlug: string, nameSlug: string): void;
}

function nameFactory(random: () => number): NameFactory {
  const used = new Set<string>();
  const key = (realmSlug: string, nameSlug: string): string => `${realmSlug}|${nameSlug}`;

  return {
    reserve(realmSlug, nameSlug) {
      used.add(key(realmSlug, nameSlug));
    },
    next(realmSlug) {
      for (let attempt = 0; ; attempt++) {
        const head = NAME_HEADS[Math.floor(random() * NAME_HEADS.length)] as string;
        const tail = NAME_TAILS[Math.floor(random() * NAME_TAILS.length)] as string;
        // A partir del tercer intento se alarga el nombre en vez de numerarlo:
        // un "thaldris2" en la base de desarrollo se lee como un error de datos.
        const middle = attempt < 2 ? "" : (NAME_HEADS[Math.floor(random() * 8)] as string);
        const nameSlug = `${head}${middle}${tail}`;
        if (used.has(key(realmSlug, nameSlug))) continue;
        used.add(key(realmSlug, nameSlug));
        return {
          nameSlug,
          nameDisplay: nameSlug.charAt(0).toUpperCase() + nameSlug.slice(1),
        };
      }
    },
  };
}

/**
 * Ids de Blizzard claramente fuera del rango real (los observados rondan los
 * 111 millones). Que se note a simple vista que una fila es sembrada evita la
 * conversación de "¿esto es de producción?" delante de una base de desarrollo.
 */
const FIRST_FAKE_BLIZZARD_ID = 900_000_000;

/**
 * Construye el dataset entero. Misma semilla y mismo `now` ⇒ mismo resultado,
 * hasta el último item.
 *
 * `now` es un parámetro y no `new Date()` por lo de siempre en este repo: es lo
 * que hace que el dataset se pueda probar. Y es la referencia de todas las
 * fechas porque `refresh-aggregates` recorta por ventana de actividad contra su
 * propio reloj — un dataset con fechas absolutas dejaría de tener población
 * dentro de la ventana al día siguiente de escribirlo.
 */
export function buildSeedDataset(options: {
  now: Date;
  seed: string;
  catalog: ItemCatalog;
}): SeedDataset {
  const { now, seed, catalog } = options;
  const random = seededRandom(seed);
  const names = nameFactory(random);

  const identities: SeedIdentity[] = [];
  const participations: SeedParticipation[] = [];
  let nextBlizzardId = FIRST_FAKE_BLIZZARD_ID;

  const seasonChange = new Date(now.getTime() - SEASON_CHANGE_DAYS_AGO * MS_PER_DAY);

  const newIdentity = (realmSlug: string, nameSlug: string, nameDisplay: string): SeedIdentity => {
    const identity: SeedIdentity = {
      realmSlug,
      nameSlug,
      nameDisplay,
      faction: FACTIONS[Math.floor(random() * FACTIONS.length)] ?? null,
      blizzardCharacterId: nextBlizzardId++,
    };
    identities.push(identity);
    return identity;
  };

  // Los nombres fijos se reservan antes de generar nada: si el generador
  // sacara "váldes" en Sanguino, el upsert fundiría los dos personajes y el
  // caso documentado dejaría de ser el que dice la documentación.
  for (const named of NAMED_CHARACTERS) {
    names.reserve(named.realmSlug, named.nameDisplay.toLowerCase());
  }

  /** Snapshots de leaderboard de la temporada vigente para un personaje. */
  const currentSeasonObservations = (
    segmentMin: number,
    rating: number,
    single: boolean,
  ): SeedObservation[] => {
    const counters = matches(segmentMin, random);
    // La última observación cae dentro de la ventana de 7 días a propósito:
    // es lo que mete al personaje en el agregado. La anterior queda a ~3 días,
    // con menos partidas, para que la actividad salga por subida vista del
    // contador y no por primera observación.
    const recent = new Date(now.getTime() - Math.floor(random() * 20 + 2) * MS_PER_HOUR);
    const latest: SeedObservation = {
      capturedAt: recent,
      rating,
      ladderRank: null,
      matchesPlayed: counters.played,
      matchesWon: counters.won,
      matchesLost: counters.lost,
      pvpTierId: tierFor(rating),
    };

    if (single) return [latest];

    const earlierPlayed = Math.max(6, counters.played - 6 - Math.floor(random() * 40));
    const earlierWon = Math.round(earlierPlayed * 0.5);
    const earlierRating = Math.max(segmentMin - 60, rating - Math.floor(random() * 90));
    const earlier: SeedObservation = {
      capturedAt: new Date(recent.getTime() - (2 + random()) * MS_PER_DAY),
      rating: earlierRating,
      ladderRank: null,
      matchesPlayed: earlierPlayed,
      matchesWon: earlierWon,
      matchesLost: earlierPlayed - earlierWon,
      pvpTierId: tierFor(earlierRating),
    };

    return [earlier, latest];
  };

  const presenceFor = (observations: readonly SeedObservation[]): SeedPresence => {
    const first = observations[0] as SeedObservation;
    const last = observations[observations.length - 1] as SeedObservation;
    return {
      firstSeenAt: first.capturedAt,
      // Más publicaciones que snapshots, y esa diferencia es el punto: desde el
      // ADR 0009 los snapshots guardan cambios y la presencia guarda vistas.
      // Contar filas para saber cuántas veces hemos visto a alguien mide otra
      // cosa.
      lastSeenAt: last.capturedAt,
      publications: observations.length + 3 + Math.floor(random() * 12),
    };
  };

  const profileFor = (
    specSlugId: string,
    segmentMin: number,
    withTalents: boolean,
    leaderboardPlayed: number,
  ): SeedProfile | null => {
    const slots = catalog.get(specSlugId);
    if (!slots) return null;

    const gear = buildGear(slots, segmentMin, random);
    const equipped = equippedLevel(gear);
    const played = asProfileCounter(leaderboardPlayed, random);
    const won = Math.round(played * (0.46 + random() * 0.12));

    return {
      // El perfil es de hace un par de días y el rating es de hoy: son fuentes
      // distintas del mismo personaje, y ese desfase es lo que la web declara
      // en `profile_data_from`/`to` en vez de dejarlo suponer.
      capturedAt: new Date(now.getTime() - (36 + random() * 24) * MS_PER_HOUR),
      equippedItemLevel: equipped,
      averageItemLevel: equipped + Math.floor(random() * 3),
      talentLoadoutCode: withTalents ? talentCode(random) : null,
      matchesPlayed: played,
      matchesWon: won,
      matchesLost: played - won,
      gear,
    };
  };

  // --- Temporada vigente ---

  const named = new Map<string, NamedCharacter[]>();
  for (const character of NAMED_CHARACTERS) {
    const key = `${character.spec}|${character.segmentMin}`;
    named.set(key, [...(named.get(key) ?? []), character]);
  }

  const returning: SeedParticipation[] = [];

  for (const plan of SEGMENT_PLAN) {
    const spec = requireSpecSlug(plan.spec);
    const bracket = shuffleBracketId(spec);
    const key = `${plan.spec}|${plan.segmentMin}`;
    // Los de nombre fijo ocupan sitio dentro de su escalón en vez de sumarse a
    // él: el plan declara cuánta población hay, y que se mueva según cuántos
    // personajes documentados haya sería una cifra que nadie podría predecir.
    const fixed = (named.get(key) ?? []).filter((character) => character.origin === "ladder");
    const generated = Math.max(0, plan.population - fixed.length);
    let profilesLeft = plan.profiles;

    const inSegment: SeedParticipation[] = [];

    for (const character of fixed) {
      const identity = newIdentity(
        character.realmSlug,
        character.nameDisplay.toLowerCase(),
        character.nameDisplay,
      );
      const observations = currentSeasonObservations(
        plan.segmentMin,
        character.rating,
        character.singleObservation,
      );
      const last = observations[observations.length - 1] as SeedObservation;
      const profile = character.profile
        ? profileFor(plan.spec, plan.segmentMin, character.talents, last.matchesPlayed)
        : null;
      if (profile) profilesLeft--;

      inSegment.push({
        identity,
        seasonId: CURRENT_SEASON,
        spec,
        bracket,
        origin: "ladder",
        observations,
        profile,
        presence: presenceFor(observations),
        covers: character.covers,
      });
    }

    for (let i = 0; i < generated; i++) {
      const realmSlug = REALMS[Math.floor(random() * REALMS.length)] as string;
      const { nameSlug, nameDisplay } = names.next(realmSlug);
      const identity = newIdentity(realmSlug, nameSlug, nameDisplay);
      const rating = ratingIn(plan.segmentMin, random);
      // Uno de cada cinco tiene una sola observación: nunca le hemos visto
      // subir el contador, así que entra en la ventana por `first-seen`. Con
      // el histórico corto que hay hoy ese es el caso mayoritario en
      // producción, y la web tiene que poder decir de qué está hecho su n.
      const observations = currentSeasonObservations(plan.segmentMin, rating, random() < 0.2);
      const last = observations[observations.length - 1] as SeedObservation;

      const takesProfile = profilesLeft > 0 && random() < profilesLeft / (generated - i);
      if (takesProfile) profilesLeft--;

      inSegment.push({
        identity,
        seasonId: CURRENT_SEASON,
        spec,
        bracket,
        origin: "ladder",
        observations,
        profile: takesProfile
          ? profileFor(
              plan.spec,
              plan.segmentMin,
              random() < plan.talentCoverage,
              last.matchesPlayed,
            )
          : null,
        presence: presenceFor(observations),
        covers: null,
      });
    }

    // Los que vuelven de la 41 salen del escalón donde está el sujeto del
    // Player Gap: es donde la web va a querer pintar un histórico que cruce el
    // corte de temporada.
    if (plan.spec === "frost-mage" && plan.segmentMin === 1800) {
      returning.push(...inSegment.slice(0, RETURNING_FROM_PREVIOUS_SEASON));
    }

    participations.push(...inSegment);
  }

  // Los que solo existen porque alguien los buscó. No dejan presencia —nunca
  // estuvieron en la lista— y salen del denominador de los agregados (ADR 0007).
  for (const character of NAMED_CHARACTERS.filter((c) => c.origin === "search")) {
    const spec = requireSpecSlug(character.spec);
    const identity = newIdentity(
      character.realmSlug,
      character.nameDisplay.toLowerCase(),
      character.nameDisplay,
    );
    const counters = matches(character.segmentMin, random);
    const profile = profileFor(
      character.spec,
      character.segmentMin,
      character.talents,
      counters.played,
    );

    participations.push({
      identity,
      seasonId: CURRENT_SEASON,
      spec,
      bracket: shuffleBracketId(spec),
      origin: "search",
      observations: [],
      profile: profile
        ? { ...profile, capturedAt: new Date(now.getTime() - random() * 6 * MS_PER_HOUR) }
        : null,
      presence: null,
      covers: character.covers,
    });
  }

  // --- Temporada anterior ---

  /**
   * Una temporada terminada está congelada: un solo snapshot por personaje.
   *
   * No es una simplificación. Desde el ADR 0009 solo se inserta la fila que
   * difiere de la anterior, y en los 647.950 pares consecutivos de la 41 no
   * hubo ni un cambio de rating ni de partidas. Lo que sí siguió creciendo es
   * la presencia: el ladder se republicaba cada ~3h con el mismo contenido.
   */
  const previousSeasonParticipation = (
    identity: SeedIdentity,
    spec: SpecEntry,
    segmentMin: number,
    covers: string | null,
  ): SeedParticipation => {
    const rating = ratingIn(segmentMin, random);
    const counters = matches(segmentMin, random);
    const capturedAt = new Date(seasonChange.getTime() - (5 + random() * 5) * MS_PER_DAY);

    return {
      identity,
      seasonId: PREVIOUS_SEASON,
      spec,
      bracket: shuffleBracketId(spec),
      origin: "ladder",
      observations: [
        {
          capturedAt,
          rating,
          ladderRank: null,
          matchesPlayed: counters.played,
          matchesWon: counters.won,
          matchesLost: counters.lost,
          pvpTierId: tierFor(rating),
        },
      ],
      profile: null,
      presence: {
        firstSeenAt: capturedAt,
        // Le seguimos viendo en la lista hasta que la temporada acabó, aunque
        // no cambiara nada. 40-70 publicaciones frente a 1 snapshot.
        lastSeenAt: seasonChange,
        publications: 40 + Math.floor(random() * 30),
      },
      covers,
    };
  };

  for (const participation of returning) {
    const isNamed = NAMED_CHARACTERS.some(
      (character) =>
        character.previousSeason &&
        character.realmSlug === participation.identity.realmSlug &&
        character.nameDisplay.toLowerCase() === participation.identity.nameSlug,
    );
    participations.push(
      previousSeasonParticipation(
        participation.identity,
        participation.spec,
        1800,
        isNamed ? "histórico que cruza el corte de temporada" : null,
      ),
    );
  }

  const frostMage = requireSpecSlug("frost-mage");
  for (let i = 0; i < PREVIOUS_SEASON_POPULATION; i++) {
    const realmSlug = REALMS[Math.floor(random() * REALMS.length)] as string;
    const { nameSlug, nameDisplay } = names.next(realmSlug);
    participations.push(
      previousSeasonParticipation(
        newIdentity(realmSlug, nameSlug, nameDisplay),
        frostMage,
        1600 + Math.floor(random() * 3) * 200,
        null,
      ),
    );
  }

  return { now, seed, identities, participations: withLadderRanks(participations) };
}

/**
 * Puesto en la lista, asignado por rating dentro de cada temporada y bracket.
 *
 * Se hace al final y no al generar cada personaje porque el `rank` es una
 * propiedad de la lista entera, no del jugador: no se puede saber en qué
 * puesto está alguien hasta que existen todos los demás.
 */
function withLadderRanks(participations: SeedParticipation[]): SeedParticipation[] {
  const byList = new Map<string, SeedParticipation[]>();
  for (const participation of participations) {
    if (participation.origin !== "ladder") continue;
    const key = `${participation.seasonId}|${participation.bracket}`;
    byList.set(key, [...(byList.get(key) ?? []), participation]);
  }

  for (const list of byList.values()) {
    const ordered = [...list].sort((a, b) => latestRating(b) - latestRating(a));
    ordered.forEach((participation, index) => {
      for (const observation of participation.observations) {
        observation.ladderRank = index + 1;
      }
    });
  }

  return participations;
}

function latestRating(participation: SeedParticipation): number {
  const last = participation.observations[participation.observations.length - 1];
  return last?.rating ?? 0;
}

/** Resumen legible del dataset, para que el comando diga qué acaba de sembrar. */
export interface SeedSummary {
  identities: number;
  participations: number;
  snapshots: number;
  gearRows: number;
  bySeason: Map<number, number>;
  /** Escalón → población y perfiles realmente generados. */
  byPlan: { plan: SegmentPlan; population: number; profiles: number }[];
}

export function summarize(dataset: SeedDataset): SeedSummary {
  const bySeason = new Map<number, number>();
  let snapshots = 0;
  let gearRows = 0;

  for (const participation of dataset.participations) {
    bySeason.set(participation.seasonId, (bySeason.get(participation.seasonId) ?? 0) + 1);
    snapshots += participation.observations.length + (participation.profile ? 1 : 0);
    gearRows += participation.profile?.gear.length ?? 0;
  }

  const byPlan = SEGMENT_PLAN.map((plan) => {
    const spec = requireSpecSlug(plan.spec);
    const bracket = shuffleBracketId(spec);
    const inSegment = dataset.participations.filter(
      (participation) =>
        participation.seasonId === CURRENT_SEASON &&
        participation.origin === "ladder" &&
        participation.bracket === bracket &&
        latestRating(participation) >= plan.segmentMin &&
        latestRating(participation) < plan.segmentMin + 200,
    );
    return {
      plan,
      population: inSegment.length,
      profiles: inSegment.filter((participation) => participation.profile !== null).length,
    };
  });

  return {
    identities: dataset.identities.length,
    participations: dataset.participations.length,
    snapshots,
    gearRows,
    bySeason,
    byPlan,
  };
}

/** Slug canónico de la spec de una participación, para imprimirlo como en la URL. */
export function participationSpecSlug(participation: SeedParticipation): string {
  return specSlug(participation.spec);
}
