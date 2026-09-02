import { foldSlug, type Region } from "@wowpvp/core";
import type { Queryable } from "./queryable";

/**
 * Las lecturas del buscador de personaje (§21 del plan, ADR 0024).
 *
 * Aquí no hay ninguna estimación, así que no hay `Provenance` que declarar ni
 * muestra que contar: lo que devuelve son **identidades**, y una identidad no
 * tiene denominador. Es la única familia de lecturas de este paquete que no
 * lleva procedencia, y es por eso.
 *
 * Lo que sí es delicado es qué forma del nombre viaja por dónde (ADR 0017):
 * se **busca** por la plegada y se **devuelve** la canónica. Plegar la
 * respuesta fundiría a los cuatro Arthaslegend de Magtheridon en uno y
 * publicaría una ruta que Blizzard contesta con un 404.
 */

/** Un personaje que casa con lo que se ha tecleado, listo para enseñarlo y enlazarlo. */
export interface CharacterSuggestion {
  /** La forma canónica: es la identidad y es la URL. Nunca la plegada. */
  realmSlug: string;
  nameSlug: string;
  /** Cómo lo escribe Blizzard, con sus mayúsculas. Es lo que se pinta. */
  nameDisplay: string;
  /**
   * Mejor rating conocido y su spec, para poder distinguir a dos homónimos.
   * `null` es "lo conocemos pero no le hemos visto rating": pasa con quien entró
   * por una búsqueda y no juega Solo Shuffle (ADR 0006, decisión 9).
   */
  rating: number | null;
  specSlug: string | null;
}

interface SuggestionRow {
  realm_slug: string;
  name_slug: string;
  name_display: string;
  rating: number | null;
  spec_slug: string | null;
}

/**
 * Mínimo de letras para sugerir. Con una o dos, el prefijo casa con miles de
 * personajes y la lista no ayuda a nadie a elegir: cuesta una consulta por
 * pulsación para devolver ruido.
 */
export const MIN_SEARCH_LENGTH = 3;

/** Techo duro de sugerencias, para que un `limit` de quien llama no pueda pedir la tabla. */
const MAX_SUGGESTIONS = 20;

export interface SearchCharactersOptions {
  region: Region;
  /** Lo que ha tecleado quien busca, sin plegar: el plegado lo hace esta función. */
  nameQuery: string;
  /** Acota al reino cuando quien busca lo sabe. Sin él se busca en todos. */
  realmSlug?: string;
  limit?: number;
}

/**
 * Los personajes de la población acumulada cuyo nombre empieza por lo tecleado.
 *
 * Devuelve `[]` con menos de `MIN_SEARCH_LENGTH` letras, y `[]` **no significa
 * "no existe"**: significa que no está en nuestra población. Quien llama decide
 * si eso justifica preguntarle a Blizzard (ADR 0024), y esa decisión no puede
 * tomarse aquí porque cuesta cuota.
 *
 * El orden lo fija esta consulta y no el planner: con un prefijo corto los
 * candidatos son cientos, y sin `order by` el primer sugerido cambiaría entre
 * dos pulsaciones idénticas. Manda el rating más alto que le conozcamos, que es
 * lo que separa al personaje que alguien busca del homónimo que nadie mira.
 */
export async function searchCharacters(
  db: Queryable,
  options: SearchCharactersOptions,
): Promise<CharacterSuggestion[]> {
  const folded = foldSlug(options.nameQuery);
  if (folded.length < MIN_SEARCH_LENGTH) return [];

  const limit = Math.min(options.limit ?? 8, MAX_SUGGESTIONS);
  const realm = options.realmSlug ?? null;

  // `like $prefix || '%'` y no `starts_with()`: es la forma que el índice de
  // prefijo de la migración 0011 sabe usar. El `_` y el `%` que pueda traer lo
  // tecleado se escapan, o quien escriba "%" recibiría la tabla entera.
  const prefix = folded.replace(/([\\%_])/gu, "\\$1");

  const { rows } = await db.query<SuggestionRow>(
    `select c.realm_slug, c.name_slug, c.name_display, s.rating, s.spec_slug
       from characters c
       left join lateral (
         select rating, spec_slug
           from latest_snapshot_per_character_bracket
          where character_id = c.id
          order by rating desc
          limit 1
       ) s on true
      where c.region = $1
        and c.name_fold like $2 || '%'
        and ($3::text is null or c.realm_slug = $3)
      order by (c.name_fold = $2) desc, s.rating desc nulls last, c.name_slug, c.realm_slug
      limit $4`,
    [options.region, prefix, realm, limit],
  );

  return rows.map((row) => ({
    realmSlug: row.realm_slug,
    nameSlug: row.name_slug,
    nameDisplay: row.name_display,
    rating: row.rating,
    specSlug: row.spec_slug,
  }));
}

/**
 * Los reinos que conocemos, en su forma canónica.
 *
 * Existe porque `realmSlug()` de `packages/core` avisa de su propio límite: lo
 * que devuelve es una *conjetura* sobre cómo Blizzard escribiría ese reino, y
 * con acentos de por medio la conjetura falla —quien teclea "Confrerie du
 * Thorium" no acierta `confrérie-du-thorium`—. Contrastarla contra esta lista
 * con `resolveByFold()` es lo que convierte la conjetura en identidad.
 *
 * La lista sale de la población, no de un catálogo de Blizzard: un reino del
 * que no conocemos a nadie tampoco tiene personajes que sugerir, y pedirle el
 * índice de reinos a la API costaría cuota para no cambiar ninguna respuesta.
 */
export async function readKnownRealms(db: Queryable, region: Region): Promise<string[]> {
  const { rows } = await db.query<{ realm_slug: string }>(
    `select distinct realm_slug from characters where region = $1 order by realm_slug`,
    [region],
  );

  return rows.map((row) => row.realm_slug);
}
