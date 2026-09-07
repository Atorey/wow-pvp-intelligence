import {
  BlizzardClient,
  getCharacterLookupTtlMinutes,
  getNotFoundCacheTtlMinutes,
  getLookupTimeBudgetMs,
  getRegion,
  lookupCharacter,
} from "@wowpvp/blizzard";
import {
  foldSlug,
  nameSlug,
  realmSlug,
  resolveByFold,
  type PlayerRoute,
  type Region,
} from "@wowpvp/core";
import {
  readKnownRealms,
  searchCharacters,
  type CharacterSuggestion,
  type Queryable,
} from "@wowpvp/data";
import { getDb } from "./db";
import "./env";

/**
 * Qué hace la web cuando alguien envía el buscador (ADR 0024).
 *
 * El orden importa y es el del ADR: primero la población acumulada, que no
 * cuesta cuota, y solo si ahí no está se le pregunta a Blizzard. Al revés se
 * gastaría una llamada por cada visitante que busca a alguien que ya tenemos.
 */

/** Cuántos homónimos por plegado se miran antes de decidir. Los grupos reales llegan a cuatro. */
const RESOLUTION_LIMIT = 20;

export type SearchResolution =
  | { status: "found"; route: PlayerRoute }
  /** Varios personajes reales cuyos nombres solo se diferencian en los acentos. */
  | { status: "ambiguous"; candidates: CharacterSuggestion[] }
  /** Blizzard dice que no existe. Es una respuesta, no un fallo. */
  | { status: "not-found" }
  /** No se pudo preguntar. Nunca se enseña como "no existe" (ADR 0013, decisión 7). */
  | { status: "unavailable" };

export interface SearchQuery {
  realm: string;
  name: string;
}

/**
 * El reino canónico que corresponde a lo tecleado.
 *
 * `realmSlug()` avisa de que lo suyo es una conjetura, y con acentos de por
 * medio falla: quien escribe "Confrerie du Thorium" no acierta
 * `confrérie-du-thorium`, y esa conjetura convertida en petición es un 404 y
 * una ficha de cuota gastada. Contrastarla contra los reinos que conocemos es
 * lo que la convierte en identidad.
 *
 * Si no casa ninguno se devuelve la conjetura tal cual: un reino del que no
 * conocemos a nadie existe igual, y quien decide si ese personaje existe es
 * Blizzard, no nuestra población.
 */
function canonicalRealm(input: string, known: readonly string[]): string {
  const guess = realmSlug(input);
  const matches = resolveByFold(guess, known);
  // El primero y no una desambiguación: dos reinos que solo se diferencien en
  // los acentos no existen en la lista de Blizzard, a diferencia de los nombres
  // de personaje, donde la colisión es real y frecuente.
  return matches[0] ?? guess;
}

/**
 * Los personajes de la población cuyo nombre **es** el tecleado, no los que
 * empiezan por él.
 *
 * `searchCharacters` busca por prefijo porque es lo que necesita el
 * autocompletado; para resolver un envío hace falta la coincidencia exacta, o
 * "anat" mandaría a quien lo escribió a la ficha de un tal Anatorey.
 */
function exactMatches(
  suggestions: readonly CharacterSuggestion[],
  name: string,
): CharacterSuggestion[] {
  const target = foldSlug(name);
  return suggestions.filter((s) => foldSlug(s.nameSlug) === target);
}

/** Los que se llaman exactamente así en ese reino, ya resueltos contra la población. */
async function matchingCharacters(
  db: Queryable,
  region: Region,
  realm: string,
  name: string,
): Promise<CharacterSuggestion[]> {
  return exactMatches(
    await searchCharacters(db, {
      region,
      nameQuery: name,
      realmSlug: realm,
      limit: RESOLUTION_LIMIT,
    }),
    name,
  );
}

/**
 * Resuelve una búsqueda: a qué perfil lleva, o por qué no lleva a ninguno.
 *
 * Cuando el personaje no está en la población, llama a Blizzard con la prioridad
 * `on-demand` —la única que puede gastar hasta la última ficha del bucket— y con
 * un presupuesto de tiempo por debajo del corte de Netlify. Agotarlo devuelve
 * `unavailable`, que **no** es `not-found`: decirle a alguien que no existe
 * porque no nos dio tiempo a mirarlo es mentirle sobre un dato que sí tenemos.
 */
export async function resolveSearch(query: SearchQuery): Promise<SearchResolution> {
  const region: Region = getRegion();
  const name = nameSlug(query.name);
  if (!name || !query.realm.trim()) return { status: "not-found" };

  const db = getDb();
  const realm = canonicalRealm(query.realm, await readKnownRealms(db, region));
  const known = await matchingCharacters(db, region, realm, name);

  const only = known[0];
  if (known.length === 1 && only) {
    return {
      status: "found",
      route: { region, realmSlug: only.realmSlug, nameSlug: only.nameSlug },
    };
  }
  if (known.length > 1) return { status: "ambiguous", candidates: known };

  // No está en la población: es exactamente el caso que §12 llama "necesario,
  // no opcional" — un jugador por debajo del corte de 5.000 del leaderboard
  // solo entra al dataset si alguien lo busca.
  const client = new BlizzardClient({
    db,
    priority: "on-demand",
    timeBudgetMs: getLookupTimeBudgetMs(),
  });

  const result = await lookupCharacter(
    {
      pool: db,
      client,
      region,
      ttlMinutes: getCharacterLookupTtlMinutes(),
      notFoundTtlMinutes: getNotFoundCacheTtlMinutes(),
      force: false,
    },
    { realmSlug: realm, nameSlug: name },
  );

  if (result.unavailable) return { status: "unavailable" };
  // También el acierto de la caché de negativos, que llega sin `stored` y por
  // tanto ya caería aquí: nombrarlo evita depender de ese efecto lateral.
  if (result.outcome === "not-found" || result.outcome === "not-found-cached" || !result.stored) {
    return { status: "not-found" };
  }

  // Se redirige a la identidad **guardada**, no a la tecleada: es la de
  // Blizzard, y es la única que la página de perfil sabe leer (ADR 0017).
  return { status: "found", route: { region, ...result.stored } };
}

/**
 * Los personajes de la población que **se llaman** así, en ese reino.
 *
 * Es lo que enseña la pantalla de desambiguación, y no vuelve a preguntar a
 * Blizzard a propósito: la página que la usa se sirve por `GET`, así que
 * gastaría cuota en cada refresco y en cada precarga (ADR 0024, decisión 2).
 */
export async function suggestExact(name: string, realm: string): Promise<CharacterSuggestion[]> {
  const region: Region = getRegion();
  const canonical = nameSlug(name);
  if (!canonical || !realm.trim()) return [];

  const db = getDb();
  return matchingCharacters(
    db,
    region,
    canonicalRealm(realm, await readKnownRealms(db, region)),
    canonical,
  );
}

/**
 * Las sugerencias del autocompletado. Solo población acumulada: aquí no se
 * llama a Blizzard, porque esto se ejecuta una vez por pulsación de teclado.
 */
export async function suggest(
  nameQuery: string,
  realm: string | null,
): Promise<CharacterSuggestion[]> {
  const region: Region = getRegion();
  const db = getDb();

  const realmSlugOrNull = realm?.trim()
    ? canonicalRealm(realm, await readKnownRealms(db, region))
    : null;

  return searchCharacters(db, {
    region,
    nameQuery,
    ...(realmSlugOrNull ? { realmSlug: realmSlugOrNull } : {}),
  });
}

/**
 * Los reinos que conocemos, para el desplegable del buscador.
 *
 * Se sirven **enteros y una sola vez**, no filtrados por lo tecleado. Son unos
 * cientos y no cambian de un minuto a otro: una petición por pulsación para
 * recortar una lista que cabe en unos kilobytes es gastar una consulta a
 * Postgres en algo que el navegador hace sin salir de la máquina.
 *
 * Que la lista salga de la población y no de un catálogo de Blizzard tiene una
 * consecuencia que el campo respeta: **no es exhaustiva**. Un reino del que no
 * conocemos a nadie existe igual, así que el campo sigue admitiendo texto libre
 * y este listado es una ayuda, no el conjunto de valores válidos.
 */
export async function knownRealms(): Promise<string[]> {
  return readKnownRealms(getDb(), getRegion());
}
