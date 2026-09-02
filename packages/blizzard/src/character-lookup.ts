/**
 * Reglas de la búsqueda de personaje, sin red ni base de datos.
 *
 * Mismo criterio que profile-mapping: aquí está lo que decide qué se pide, qué
 * se guarda y cuándo no hace falta preguntar a Blizzard; el job de al lado solo
 * lo ejecuta. Es la parte que la web de Phase 2 heredará tal cual.
 */
import { findSpec, parseShuffleBracket, type SpecEntry } from "@wowpvp/core";
import { specNameToSlug, type ProfileResponse } from "./profile-mapping";

// --- Brackets ---

export interface PvpSummaryResponse {
  brackets?: { href?: string }[];
}

/** Un bracket de Solo Shuffle que este personaje juega, listo para pedirlo. */
export interface ShuffleBracketRef {
  bracket: string;
  spec: SpecEntry;
  /** Ruta del endpoint, tal como la publica el propio pvp-summary. */
  path: string;
}

/**
 * Brackets de Solo Shuffle que juega el personaje, sacados de su pvp-summary.
 *
 * No se adivina qué specs juega ni se prueban las 40 a ver cuál responde: se
 * siguen los enlaces que la propia API declara, que es lo mismo que hace
 * validate-endpoints y cuesta una petición por bracket real en vez de 40.
 *
 * Se filtra a shuffle porque es lo único que el modelo sabe representar hoy:
 * class_slug y spec_slug se deducen del bracket, y "2v2" no nombra ninguna spec.
 * 2v2/3v3/RBG entran con #34, no antes y no a medias.
 */
export function shuffleBracketsFromSummary(summary: PvpSummaryResponse): ShuffleBracketRef[] {
  const found = new Map<string, ShuffleBracketRef>();

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
    if (!bracket) continue;

    const spec = parseShuffleBracket(bracket);
    if (!spec) continue;

    if (!found.has(bracket)) found.set(bracket, { bracket, spec, path });
  }

  return [...found.values()].sort((a, b) => a.bracket.localeCompare(b.bracket));
}

// --- Spec activa ---

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
