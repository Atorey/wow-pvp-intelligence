/**
 * Forma canónica de un personaje: reino y nombre, la misma en la URL, en la
 * base de datos y en lo que se le pide a Blizzard.
 *
 * Vive aquí, junto al catálogo de specs y por la misma razón que él (ADR 0016):
 * el pipeline normaliza al insertar y la web normaliza al buscar, y si las dos
 * normalizaran distinto el mismo jugador entraría dos veces y su histórico
 * quedaría partido — que es justo lo que el producto vende (ADR 0002).
 *
 * La regla no es "quitar tildes", aunque el plan lo insinúe. Medido sobre los
 * 126.920 personajes acumulados: 37.337 tienen el nombre fuera del ASCII, 20.081
 * lo siguen teniendo después de plegar los diacríticos (cirílico, ø, æ, ð, ß), y
 * hay 1.424 grupos de personajes **distintos** del mismo reino cuyos nombres
 * solo se diferencian en los acentos — cuatro Arthaslegend en Magtheridon, tres
 * Smokyy en Ravencrest. Plegar la identidad los fundiría en uno.
 *
 * Por eso hay dos formas y no una, con papeles distintos (ADR 0017):
 *
 * - **canónica** (`nameSlug`, `realmSlug`): la de Blizzard, minúsculas con los
 *   diacríticos intactos. Es la identidad y es la URL.
 * - **plegada** (`foldSlug`): solo para *buscar*. Casa variantes, admite varios
 *   resultados y nunca se persiste como identidad ni se publica como ruta.
 */

/** Un personaje tal como lo nombra quien busca: reino y nombre, ya canónicos. */
export interface CharacterRef {
  realmSlug: string;
  nameSlug: string;
}

/**
 * Letras que `NFD` no descompone porque no son "letra + acento", sino letras
 * propias del alfabeto que las usa.
 *
 * Sin esta tabla el plegado no sirve para media Europa: `smøkyy` seguiría sin
 * casar con `smokyy`, y son 20.081 nombres de la población acumulada los que
 * salen del ASCII por aquí y no por un acento. La equivalencia es la que usa
 * quien teclea sin el carácter especial, no una transliteración académica.
 *
 * El cirílico no entra: no hay una forma "sin acentos" del ruso, hay
 * transliteraciones —varias, incompatibles entre sí— y quien busca a
 * `рейзаксия` lo escribe en ruso. `ё` y `й` sí se pliegan, pero eso lo hace
 * `NFD` solo, porque ahí sí hay un diacrítico de por medio.
 */
const NON_DECOMPOSING: ReadonlyMap<string, string> = new Map([
  ["ß", "ss"],
  ["ø", "o"],
  ["æ", "ae"],
  ["œ", "oe"],
  ["ð", "d"],
  ["þ", "th"],
  ["đ", "d"],
  ["ł", "l"],
  ["ħ", "h"],
  ["ŋ", "n"],
  ["ı", "i"],
]);

/**
 * Nombre canónico de un personaje: `Ánatorey` → `ánatorey`.
 *
 * Minúsculas y nada más. **No** se le quitan los acentos, por las tres razones
 * de la cabecera: es la forma con la que Blizzard responde (`profile.name`), es
 * la que la API acepta en la ruta —la versión sin acento devuelve 404, no una
 * respuesta vacía— y es la única que distingue a los cuatro Arthaslegend.
 */
export function nameSlug(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Slug canónico de un reino: `Confrérie du Thorium` → `confrérie-du-thorium`.
 *
 * Reproduce la regla de Blizzard, que **conserva los diacríticos**: en la
 * población acumulada están `confrérie-du-thorium`, `aggra-português`,
 * `chants-éternels`, `la-croisade-écarlate`, `festung-der-stürme` y
 * `marécage-de-zangar`, todos tal cual los publica la API. Un slug de reino
 * "normalizado" a ASCII no es más limpio: es un 404 y un join vacío.
 *
 * Lo que sí desaparece son los apóstrofos (`Pozzo dell'Eternità` →
 * `pozzo-delleternità`) y los paréntesis (`Aggra (Português)` →
 * `aggra-português`); los espacios pasan a guion.
 *
 * Aun así esto es una *conjetura* sobre el nombre para mostrar, no una fuente de
 * verdad: cuando el reino ya viene de Blizzard no se recalcula, se usa. Para
 * entrada de usuario, lo que decide es `resolveByFold` contra los reinos que
 * conocemos, no esta función a solas.
 */
export function realmSlug(realm: string): string {
  return realm
    .trim()
    .toLowerCase()
    .replace(/['’]/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

/**
 * Clave de búsqueda de un slug canónico: `árthaslegend` → `arthaslegend`.
 *
 * Es lo que permite que quien escribe `Arthaslegend` encuentre a `artháslegend`
 * sin saber dónde iba la tilde. No es la identidad de nadie y no se publica en
 * ninguna ruta: casar por aquí puede devolver varios personajes reales (1.424
 * grupos lo hacen), y ese caso se desambigua, no se resuelve a suertes.
 *
 * Es idempotente a propósito —`foldSlug(foldSlug(x)) === foldSlug(x)`—, porque
 * se aplica indistintamente a lo que teclea alguien y a lo que ya está guardado.
 */
export function foldSlug(slug: string): string {
  return [...slug.trim().toLowerCase().normalize("NFD")]
    .filter((ch) => !/\p{M}/u.test(ch))
    .map((ch) => NON_DECOMPOSING.get(ch) ?? ch)
    .join("")
    .normalize("NFC");
}

/**
 * Los slugs conocidos que casan con lo que se ha tecleado, por plegado.
 *
 * Devuelve una lista y no un slug porque la ambigüedad es real y frecuente: el
 * plegado no es inyectivo, y quien llama tiene que decidir qué hace con dos
 * respuestas (desambiguar) en vez de quedarse con la primera. Vacío es "no lo
 * conocemos", que no es lo mismo que "no existe": puede estar en Blizzard y no
 * en nuestra población todavía.
 *
 * El orden es el de `known`, para que quien llama pueda decidirlo (por rating,
 * por lo reciente) sin que esta función se invente un criterio.
 */
export function resolveByFold(input: string, known: readonly string[]): string[] {
  const target = foldSlug(input);
  return known.filter((slug) => foldSlug(slug) === target);
}

/**
 * `Twisting Nether/Anatorey` → `{ realmSlug: "twisting-nether", nameSlug: "anatorey" }`.
 *
 * Acepta el reino escrito como slug o como nombre para mostrar, porque quien
 * escribe a mano hace las dos cosas. Lo que devuelve es la forma canónica
 * *probable*: para el reino sigue siendo una conjetura hasta contrastarla con
 * los reinos conocidos (ver `realmSlug`).
 */
export function parseCharacterRef(value: string): CharacterRef {
  const parts = value.split("/");
  const [realm, name] = parts;

  if (parts.length !== 2 || !realm?.trim() || !name?.trim()) {
    throw new Error(
      `"${value}" no tiene la forma reino/nombre (p.ej. twisting-nether/anatorey). ` +
        `El reino admite el slug o el nombre: "Twisting Nether" → twisting-nether.`,
    );
  }

  return { realmSlug: realmSlug(realm), nameSlug: nameSlug(name) };
}

/** Cómo se escribe una referencia para logs y mensajes de error. */
export function formatCharacterRef(ref: CharacterRef): string {
  return `${ref.realmSlug}/${ref.nameSlug}`;
}
