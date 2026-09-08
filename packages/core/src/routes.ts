/**
 * Mapa de rutas del sitio: la forma exacta de cada URL pública y su inversa.
 *
 * Vive aquí, junto al catálogo de specs y a la forma canónica de personaje, por
 * la misma razón que ellos (ADR 0016, ADR 0017): la URL es identidad pública, se
 * indexa y después no se puede cambiar sin quemar posicionamiento, así que no
 * puede haber dos sitios que la construyan. La web la pinta y el pipeline la
 * generará para el sitemap y el enlazado interno; si cada uno la montara por su
 * cuenta, el día que discrepen no se enteraría nadie hasta ver el índice partido.
 *
 * Lo que este módulo NO decide es el idioma: las rutas de aquí van sin prefijo
 * de locale y quien las publica les antepone `/en` o `/es` (ADR 0012, decisión
 * 2). El dominio no sabe de idiomas, y el prefijo es lo único que distingue las
 * dos versiones de la misma página (ADR 0012, decisión 3).
 */
import { type CharacterRef, nameSlug, realmSlug } from "./characters";
import { DEFAULT_SEGMENT_SCALE, type SegmentScale, allSegments } from "./segments";
import { parseSpecSlug, shuffleBracketId, specSlug } from "./specs";
import type { RatingSegment, Region, SpecEntry } from "./types";

/**
 * Las regiones de la API de Blizzard. El MVP lanza con una sola, pero la ruta
 * de perfil la lleva siempre: la identidad de un personaje es
 * `(region, realm_slug, name_slug)` —así está la unicidad en la BD—, y
 * `sanguino/ánatorey` sin región deja de identificar a nadie en cuanto haya dos.
 */
export const REGIONS: readonly Region[] = ["eu", "us", "kr", "tw"];

export function isRegion(value: string): value is Region {
  return (REGIONS as readonly string[]).includes(value);
}

/**
 * Las modalidades que el sitio publica como tramo de ruta. Hoy solo hay una: el
 * MVP es Solo Shuffle y nada más (§25 del plan).
 *
 * No coincide con lo que la BD guarda en `bracket`, que es el bracket de
 * Blizzard por spec (`shuffle-mage-frost`). Aquí `solo-shuffle` nombra la
 * modalidad y la spec va en su propio tramo, porque así se lee la URL y así se
 * puede subir un nivel: `/spec/frost-mage/solo-shuffle` → `/spec/frost-mage`.
 * La correspondencia entre las dos formas es `bracketIdFor`.
 */
export const BRACKET_SLUGS = ["solo-shuffle"] as const;

export type BracketSlug = (typeof BRACKET_SLUGS)[number];

export function isBracketSlug(value: string): value is BracketSlug {
  return (BRACKET_SLUGS as readonly string[]).includes(value);
}

/**
 * Cómo se escribe una modalidad en pantalla. Está aquí y no en los diccionarios
 * de la web porque no es copy: la terminología del juego no se traduce en
 * ninguna de las dos lenguas (brief §3.2), así que tener una sola forma es la
 * manera de que no aparezca una "Solo Shuffle" traducida por descuido.
 */
export const BRACKET_LABELS: Record<BracketSlug, string> = {
  "solo-shuffle": "Solo Shuffle",
};

/**
 * El `bracket` que la BD guarda para una modalidad y una spec.
 *
 * Es el único puente entre el tramo de URL y la columna, y no se construye a
 * mano en ningún otro sitio: `shuffleBracketId` ya sabe que Blizzard aplasta los
 * slugs compuestos ("death-knight" → "deathknight").
 */
export function bracketIdFor(bracket: BracketSlug, spec: SpecEntry): string {
  switch (bracket) {
    case "solo-shuffle":
      return shuffleBracketId(spec);
  }
}

/**
 * El tramo abierto de arriba se escribe `3000-plus`, no `3000+`.
 *
 * `formatSegment` lo escribe con `+` porque es como se lee, pero un `+` en una
 * ruta viaja mal —se escapa a `%2B` según quién la toque— y el `3000-Infinity`
 * que guarda `segment_id` no es escribible. `-plus` es ASCII, conserva la
 * simetría con `2800-3000` y dice lo que el tramo significa.
 */
const OPEN_SEGMENT_SUFFIX = "plus";

export function segmentSlug(segment: RatingSegment): string {
  return Number.isFinite(segment.max)
    ? `${segment.min}-${segment.max}`
    : `${segment.min}-${OPEN_SEGMENT_SUFFIX}`;
}

/**
 * Inverso de `segmentSlug`, resuelto contra los tramos que la escala genera de
 * verdad y nunca partiendo el string por el guion.
 *
 * Que `2010-2190` no exista importa más aquí que en cualquier otro parseo: si la
 * ruta admitiera dos números cualesquiera, el sitio publicaría infinitas URL con
 * el mismo contenido, que es exactamente el thin content que §22 prohíbe.
 */
export function parseSegmentSlug(
  slug: string,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): RatingSegment | undefined {
  return allSegments(scale).find((segment) => segmentSlug(segment) === slug);
}

export const HOME_PATH = "/";
export const METHODOLOGY_PATH = "/methodology";

/**
 * Las secciones de la página de metodología, en el orden en el que se leen.
 *
 * Son catálogo y no texto: un `id` de sección es destino de enlace desde otras
 * páginas —el perfil apunta al apartado de confianza— y por eso se escribe una
 * sola vez aquí, como el resto de las rutas. Van en inglés en las dos lenguas,
 * igual que los tramos de ruta (ADR 0012, decisión 3): lo único que distingue
 * la versión española de la inglesa es el prefijo.
 */
export const METHODOLOGY_SECTIONS = [
  "sources",
  "observed",
  "segments",
  "confidence",
  "numbers",
  "correlation",
] as const;

export type MethodologySection = (typeof METHODOLOGY_SECTIONS)[number];

/**
 * La página entera, o uno de sus apartados.
 *
 * El fragmento va aquí y no concatenado en quien enlaza porque un `#` escrito a
 * mano no lo comprueba nadie: apunta a un apartado que puede no existir y falla
 * en silencio, dejando al lector arriba del todo sin decir que se ha perdido.
 */
export function methodologyPath(section?: MethodologySection): string {
  return section === undefined ? METHODOLOGY_PATH : `${METHODOLOGY_PATH}#${section}`;
}
/**
 * La política de privacidad, que el ADR 0020 declaró sin código y el ADR 0028
 * abre. No es una página opcional: la 2.p de la ToU obliga a publicarla y le
 * condiciona el contenido (ADR 0015, decisión 9).
 */
export const PRIVACY_PATH = "/privacy";
/**
 * Dónde aterriza un envío del buscador que no lleva a un perfil concreto
 * (ADR 0024). No se indexa y no aparece en el sitemap: su contenido es la
 * consulta de una persona, no una página del catálogo.
 */
export const SEARCH_PATH = "/search";

/**
 * Cómo acabó un envío del buscador que no llevó a un perfil.
 *
 * Viaja en la URL porque la página que lo enseña **no puede volver a
 * averiguarlo**: preguntárselo otra vez a Blizzard costaría cuota en cada
 * refresco y en cada precarga, y es lo que la decisión 2 del ADR 0024 saca de
 * los `GET`. Con `ambiguous` basta releer la población, que es gratis.
 *
 * `rate-limited` lo aprovecha por partida doble: quien acaba de tocar el límite
 * es justo a quien no se le puede cobrar otra petición por refrescar la página.
 */
export type SearchStatus = "ambiguous" | "not-found" | "unavailable" | "rate-limited";

/**
 * `/search?realm=sanguino&name=%C3%A1natorey`.
 *
 * Los dos tramos van en la query y no en la ruta porque aquí no nombran a nadie
 * todavía: son lo que se tecleó, que puede no existir, estar a medias o casar
 * con varios. Una ruta afirmaría una identidad que aún no está resuelta.
 */
export function searchPath(query: { realm: string; name: string; status?: SearchStatus }): string {
  const params = new URLSearchParams({ realm: query.realm, name: query.name });
  if (query.status) params.set("status", query.status);
  return `${SEARCH_PATH}?${params.toString()}`;
}

export function isSearchStatus(value: string): value is SearchStatus {
  return (
    value === "ambiguous" ||
    value === "not-found" ||
    value === "unavailable" ||
    value === "rate-limited"
  );
}

/** Un personaje tal como lo nombra su ruta: la referencia canónica más la región. */
export interface PlayerRoute extends CharacterRef {
  region: Region;
}

/**
 * `/player/eu/sanguino/ánatorey`.
 *
 * Los tramos se codifican porque uno de cada tres nombres de personaje sale del
 * ASCII y una ruta con caracteres crudos no es una URL válida, aunque el
 * navegador la perdone. Lo codificado es la escritura, no la identidad: la forma
 * canónica sigue siendo la acentuada (ADR 0017) y es la que se ve en la barra.
 */
export function playerPath(route: PlayerRoute): string {
  const realm = encodeURIComponent(route.realmSlug);
  const name = encodeURIComponent(route.nameSlug);
  return `/player/${route.region}/${realm}/${name}`;
}

/**
 * `/spec/frost-mage`, `/spec/frost-mage/solo-shuffle` o
 * `/spec/frost-mage/solo-shuffle/2000-2200`, según hasta dónde concrete.
 *
 * Los tres niveles son la misma jerarquía, no tres páginas sueltas: cada uno
 * añade un filtro al anterior, y §22 los indexa por separado porque el contenido
 * de cada uno es distinto, no el mismo con una palabra cambiada.
 */
export function specPath(spec: SpecEntry, bracket?: BracketSlug, segment?: RatingSegment): string {
  if (segment && !bracket) {
    // Un segmento sin modalidad no es una página que exista: los agregados se
    // calculan por (bracket, segmento), nunca por segmento a solas.
    throw new Error(
      `No se puede construir la ruta del segmento ${segmentSlug(segment)} sin modalidad.`,
    );
  }

  const parts = ["spec", specSlug(spec)];
  if (bracket) parts.push(bracket);
  if (segment) parts.push(segmentSlug(segment));
  return `/${parts.join("/")}`;
}

/**
 * Qué hace la web con lo que venga en los tramos dinámicos de una ruta.
 *
 * Son tres respuestas y no dos porque "esto no existe" y "esto existe, pero
 * escrito de otra forma" merecen cosas distintas: la segunda es la que evita que
 * `/spec/Frost-Mage` y `/spec/frost-mage` acaben siendo dos URL indexables con
 * el mismo contenido.
 */
export type RouteResolution<TRoute> =
  | { status: "canonical"; route: TRoute }
  | { status: "redirect"; path: string }
  | { status: "unknown" };

/**
 * Lo que un tramo de ruta dice de verdad, ya sin escapar.
 *
 * Los tramos dinámicos llegan tal como viajan por la URL, y un nombre de
 * personaje sale del ASCII en uno de cada tres casos: sin decodificar,
 * `ánatorey` entra como `%C3%A1natorey`, no casa con su forma canónica y acaba
 * redirigiendo a `%25c3%25a1natorey`, que ya no es nadie.
 *
 * Decodificar aquí es seguro porque ningún slug de este producto lleva un `%`
 * propio: ni los nombres ni los reinos que publica Blizzard, ni los slugs de
 * spec, modalidad o segmento, que son ASCII.
 */
function decodeRouteSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    // Un escape mal formado no es un tramo interpretable. Se deja como vino y lo
    // rechaza quien lo contraste con el catálogo, que es quien sabe decir "esto
    // no existe" sin inventarse una corrección.
    return value;
  }
}

export interface PlayerRouteParams {
  region: string;
  realm: string;
  name: string;
}

/**
 * Resuelve los tramos de `/player/{region}/{realm}/{name}`.
 *
 * La canonicalización que pide §22 —"variantes de capitalización/tildes"— es
 * solo la mitad izquierda de la frase: se canonicaliza la caja, nunca los
 * acentos. Plegarlos fundiría personajes distintos (ADR 0017), así que
 * `/player/eu/magtheridon/arthaslegend` no redirige a `árthaslegend` ni al
 * revés: son dos personas y son dos páginas.
 */
export function resolvePlayerRoute(params: PlayerRouteParams): RouteResolution<PlayerRoute> {
  const written = {
    region: decodeRouteSegment(params.region),
    realm: decodeRouteSegment(params.realm),
    name: decodeRouteSegment(params.name),
  };

  const region = written.region.trim().toLowerCase();
  if (!isRegion(region)) return { status: "unknown" };

  const realm = realmSlug(written.realm);
  const name = nameSlug(written.name);
  if (!realm || !name) return { status: "unknown" };

  const route: PlayerRoute = { region, realmSlug: realm, nameSlug: name };
  const asWritten = region === written.region && realm === written.realm && name === written.name;

  return asWritten
    ? { status: "canonical", route }
    : { status: "redirect", path: playerPath(route) };
}

export interface SpecRouteParams {
  spec: string;
  bracket?: string;
  segment?: string;
}

export interface SpecRoute {
  spec: SpecEntry;
  /** `undefined` cuando la URL se queda en el nivel de spec, sin modalidad. */
  bracket: BracketSlug | undefined;
  /** `undefined` cuando la URL no baja a un tramo de rating concreto. */
  segment: RatingSegment | undefined;
}

/**
 * Resuelve los tres niveles de `/spec/…`. Los tramos que no están en la URL se
 * omiten, no se pasan vacíos: `{ spec }` es la página de spec y
 * `{ spec, bracket }` la de modalidad.
 */
export function resolveSpecRoute(
  params: SpecRouteParams,
  scale: SegmentScale = DEFAULT_SEGMENT_SCALE,
): RouteResolution<SpecRoute> {
  const writtenSpec = decodeRouteSegment(params.spec);
  const specInput = writtenSpec.trim().toLowerCase();
  const spec = parseSpecSlug(specInput);
  if (!spec) return { status: "unknown" };

  let bracket: BracketSlug | undefined;
  let writtenBracket: string | undefined;
  let bracketInput: string | undefined;
  if (params.bracket !== undefined) {
    writtenBracket = decodeRouteSegment(params.bracket);
    bracketInput = writtenBracket.trim().toLowerCase();
    if (!isBracketSlug(bracketInput)) return { status: "unknown" };
    bracket = bracketInput;
  }

  let segment: RatingSegment | undefined;
  let writtenSegment: string | undefined;
  if (params.segment !== undefined) {
    // Un segmento colgando de una spec sin modalidad no es una URL mal escrita
    // que se pueda arreglar redirigiendo: no hay a dónde.
    if (!bracket) return { status: "unknown" };

    writtenSegment = decodeRouteSegment(params.segment);
    const segmentInput = writtenSegment.trim().toLowerCase();
    segment = parseSegmentSlug(segmentInput, scale) ?? parseWrittenSegment(segmentInput, scale);
    if (!segment) return { status: "unknown" };
  }

  const asWritten =
    specInput === writtenSpec &&
    bracketInput === writtenBracket &&
    (segment === undefined || segmentSlug(segment) === writtenSegment);

  return asWritten
    ? { status: "canonical", route: { spec, bracket, segment } }
    : { status: "redirect", path: specPath(spec, bracket, segment) };
}

/**
 * El tramo abierto tal como lo escribe `formatSegment` y como lo teclea quien lo
 * ha leído en pantalla: `3000+`.
 *
 * No es una segunda forma canónica —redirige a `3000-plus`—, pero tampoco es un
 * 404: la cifra con `+` es la que el producto enseña, y contestar "no existe" a
 * quien copia lo que ve en la página es un error nuestro, no suyo.
 */
function parseWrittenSegment(slug: string, scale: SegmentScale): RatingSegment | undefined {
  if (!slug.endsWith("+")) return undefined;
  return allSegments(scale).find(
    (segment) => !Number.isFinite(segment.max) && `${segment.min}+` === slug,
  );
}
