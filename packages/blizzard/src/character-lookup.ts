/**
 * Reglas de la búsqueda de personaje, sin red ni base de datos.
 *
 * Mismo criterio que profile-mapping: aquí está lo que decide qué se pide, qué
 * se guarda y cuándo no hace falta preguntar a Blizzard; el job de al lado solo
 * lo ejecuta. Es la parte que la web de Phase 2 heredará tal cual.
 */
import {
  findSpec,
  isArenaBracket,
  parseShuffleBracket,
  type ArenaBracket,
  type SpecEntry,
} from "@wowpvp/core";
import { specNameToSlug, type ProfileResponse } from "./profile-mapping";

// --- Brackets ---

export interface PvpSummaryResponse {
  brackets?: { href?: string }[];
}

/**
 * Un bracket que este personaje juega, listo para pedirlo.
 *
 * Los dos tipos se separan porque la spec sale de sitios distintos: en Solo
 * Shuffle la nombra el bracket, y en arena solo la sabe el perfil, con su
 * `active_spec` (ADR 0048). Quien guarda la observación decide con cuál.
 */
export type BracketRef =
  | { kind: "shuffle"; bracket: string; spec: SpecEntry; path: string }
  | { kind: "arena"; bracket: ArenaBracket; path: string };

/**
 * Brackets que juega el personaje, sacados de su pvp-summary.
 *
 * No se adivina qué specs juega ni se prueban las 40 a ver cuál responde: se
 * siguen los enlaces que la propia API declara, que es lo mismo que hace
 * validate-endpoints y cuesta una petición por bracket real en vez de 40.
 *
 * Entran los de Solo Shuffle que el catálogo reconoce y los de arena que estén
 * encendidos en `arena`. RBG y Blitz se descartan: el modelo no los representa,
 * y una modalidad nueva es una decisión (ADR 0048), no un enlace más.
 */
export function bracketsFromSummary(
  summary: PvpSummaryResponse,
  arena: readonly ArenaBracket[] = [],
): BracketRef[] {
  const found = new Map<string, BracketRef>();

  for (const link of summary.brackets ?? []) {
    if (!link.href) continue;

    let path: string;
    try {
      path = new URL(link.href).pathname;
    } catch {
      // Un href ilegible es un dato roto de la API, no un bracket que no se
      // juega: se ignora ese enlace, no la búsqueda entera.
      continue;
    }

    const bracket = path.split("/").filter(Boolean).pop();
    if (!bracket || found.has(bracket)) continue;

    const spec = parseShuffleBracket(bracket);
    if (spec) {
      found.set(bracket, { kind: "shuffle", bracket, spec, path });
    } else if (isArenaBracket(bracket) && arena.includes(bracket)) {
      found.set(bracket, { kind: "arena", bracket, path });
    }
  }

  return [...found.values()].sort((a, b) => a.bracket.localeCompare(b.bracket));
}

// --- Spec activa ---

/**
 * Con qué spec se guarda la observación de un bracket.
 *
 * En Solo Shuffle la nombra el bracket. En arena es la que lleva puesta ahora
 * (`active`), y no la de su Solo Shuffle ni la de otro bracket: que juegue Frost
 * en Shuffle no dice con qué juega 3v3 (ADR 0048). `null` = no hay con qué
 * guardarla, porque el perfil no trae una spec activa que el catálogo reconozca.
 */
export function observationSpec(ref: BracketRef, active: SpecEntry | null): SpecEntry | null {
  return ref.kind === "shuffle" ? ref.spec : active;
}

/**
 * Spec que el personaje lleva equipada ahora mismo, resuelta contra el catálogo.
 *
 * Importa por una razón concreta: la API devuelve **un solo** equipo, el que
 * lleva puesto. Un jugador que juega tres shuffles con tres specs distintas no
 * lleva el mismo gear en las tres, así que atribuir ese equipo a los otros dos
 * brackets sería inventarse una build que nadie ha observado — y esa build
 * entraría luego en el adoption_rate del segmento.
 */
export function activeSpecOf(profile: ProfileResponse): SpecEntry | null {
  const className = profile.character_class?.name;
  const specName = profile.active_spec?.name;
  if (!className || !specName) return null;

  return findSpec(specNameToSlug(className), specNameToSlug(specName)) ?? null;
}

// --- Caché ---

/**
 * ¿Hace falta volver a preguntar a Blizzard?
 *
 * §28 pide caché corta (15-30 min) para que buscar cinco veces al mismo
 * personaje no cueste cinco veces la cuota. El TTL se mide sobre la última
 * captura de perfil que tenemos de él, venga de una búsqueda o del muestreo: lo
 * que decide es la frescura del dato, no quién lo trajo.
 *
 * `lastCapturedAt` a null significa "nunca se le ha bajado el perfil" — no hay
 * nada que refrescar, hay que traerlo.
 */
export function isProfileFresh(
  lastCapturedAt: Date | null,
  now: Date,
  ttlMinutes: number,
): boolean {
  if (!lastCapturedAt) return false;

  const ageMs = now.getTime() - lastCapturedAt.getTime();

  // Una captura con fecha futura es un reloj mal puesto (nuestro o del
  // servidor), no un dato fresquísimo: se trata como caducada para no dejar a un
  // personaje congelado hasta que el futuro alcance a su timestamp.
  if (ageMs < 0) return false;

  return ageMs < ttlMinutes * 60_000;
}
