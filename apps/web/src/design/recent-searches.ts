/**
 * Las búsquedas anteriores del visitante.
 *
 * Viven en `localStorage` y no en el servidor a propósito: son de quien tiene
 * el navegador delante, no de una cuenta —el producto no tiene cuentas— y
 * guardarlas en Postgres convertiría una comodidad en un registro de quién
 * mira a quién. De ahí que el copy diga dónde se guardan.
 *
 * Lo puro está separado de lo que toca el navegador para poder probarlo con
 * `node:test`: `parseRecent` y `withRecent` son funciones, y `readRecent` y
 * `rememberSearch` son las dos únicas que saben que existe `localStorage`.
 */

export interface RecentSearch {
  /** La forma canónica, que es la identidad y es la URL (ADR 0017). */
  readonly realmSlug: string;
  readonly nameSlug: string;
  /** Cómo lo escribe Blizzard. Es lo que se pinta. */
  readonly nameDisplay: string;
  /** Slug canónico de spec ("frost-mage"), o `null` si no consta. */
  readonly specSlug: string | null;
  readonly rating: number | null;
  /** Milisegundos epoch. Ordena la lista; no se enseña. */
  readonly at: number;
}

const KEY = "one-rung:recent-searches";

/**
 * Tres, que son las que caben en una fila del tablero. Una lista que crece sin
 * fin deja de ser "las anteriores" y pasa a ser un historial, que es otra cosa
 * y pide poder borrar entradas sueltas.
 */
export const MAX_RECENT = 3;

function isRecentSearch(value: unknown): value is RecentSearch {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry["realmSlug"] === "string" &&
    typeof entry["nameSlug"] === "string" &&
    typeof entry["nameDisplay"] === "string" &&
    (typeof entry["specSlug"] === "string" || entry["specSlug"] === null) &&
    (typeof entry["rating"] === "number" || entry["rating"] === null) &&
    typeof entry["at"] === "number"
  );
}

/**
 * Lee lo guardado. Descarta lo que no reconozca en vez de fallar: en
 * `localStorage` escribe cualquier versión anterior del sitio, y una entrada
 * con otra forma no puede tumbar la portada.
 */
export function parseRecent(raw: string | null): RecentSearch[] {
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return parsed.filter(isRecentSearch).slice(0, MAX_RECENT);
}

/** Añade una entrada delante, sin duplicar personaje, y recorta a `MAX_RECENT`. */
export function withRecent(list: readonly RecentSearch[], entry: RecentSearch): RecentSearch[] {
  const others = list.filter(
    (other) => other.realmSlug !== entry.realmSlug || other.nameSlug !== entry.nameSlug,
  );
  return [entry, ...others].slice(0, MAX_RECENT);
}

/**
 * Todo acceso a `localStorage` va envuelto: en una ventana privada, con las
 * cookies de sitio bloqueadas o con la cuota llena, el acceso **lanza**. Una
 * comodidad no puede romper la página que la aloja.
 */
export function readRecent(): RecentSearch[] {
  try {
    return parseRecent(window.localStorage.getItem(KEY));
  } catch {
    return [];
  }
}

export function rememberSearch(entry: Omit<RecentSearch, "at">): void {
  try {
    const next = withRecent(readRecent(), { ...entry, at: Date.now() });
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Sin sitio donde guardar, la búsqueda sigue funcionando igual.
  }
}

export function clearRecent(): void {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // Ídem: si no se puede borrar, tampoco se pudo guardar.
  }
}
