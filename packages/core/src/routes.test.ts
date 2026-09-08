import assert from "node:assert/strict";
import { test } from "node:test";

import {
  BRACKET_SLUGS,
  bracketIdFor,
  isRegion,
  METHODOLOGY_PATH,
  METHODOLOGY_SECTIONS,
  SEARCH_PATH,
  isSearchStatus,
  methodologyPath,
  searchPath,
  parseSegmentSlug,
  playerPath,
  resolvePlayerRoute,
  resolveSpecRoute,
  segmentSlug,
  specPath,
} from "./routes";
import { DEFAULT_SEGMENT_SCALE, allSegments, segmentFor } from "./segments";
import { requireSpec } from "./specs";

test("la ruta de perfil lleva la región y conserva los acentos", () => {
  const path = playerPath({
    region: "eu",
    realmSlug: "confrérie-du-thorium",
    nameSlug: "ánatorey",
  });
  // Codificada es como viaja; decodificada es la identidad (ADR 0017).
  assert.equal(decodeURIComponent(path), "/player/eu/confrérie-du-thorium/ánatorey");
});

test("los tres niveles de spec cuelgan unos de otros", () => {
  const frost = requireSpec("mage", "frost");
  assert.equal(specPath(frost), "/spec/frost-mage");
  assert.equal(specPath(frost, "solo-shuffle"), "/spec/frost-mage/solo-shuffle");
  assert.equal(
    specPath(frost, "solo-shuffle", segmentFor(2050)),
    "/spec/frost-mage/solo-shuffle/2000-2200",
  );
});

test("un segmento sin modalidad no es una ruta que exista", () => {
  assert.throws(() => specPath(requireSpec("mage", "frost"), undefined, segmentFor(2050)));
});

test("el tramo abierto se escribe -plus y no + ni Infinity", () => {
  const top = segmentFor(3200);
  assert.equal(segmentSlug(top), "3000-plus");
  // El id que guarda la BD no es escribible en una ruta; el slug sí.
  assert.equal(top.id, "3000-Infinity");
});

test("todos los tramos de la escala tienen slug y todos vuelven", () => {
  for (const segment of allSegments(DEFAULT_SEGMENT_SCALE)) {
    assert.deepEqual(parseSegmentSlug(segmentSlug(segment)), segment);
  }
});

test("un tramo inventado no es una ruta, aunque tenga forma de tramo", () => {
  // Si esto resolviera, el sitio publicaría infinitas URL con el mismo
  // contenido, que es el thin content que §22 prohíbe.
  assert.equal(parseSegmentSlug("2010-2190"), undefined);
  assert.equal(parseSegmentSlug("2000-2100"), undefined);
  assert.deepEqual(parseSegmentSlug("2000-2200"), segmentFor(2000));
});

test("la modalidad de la URL se traduce al bracket que guarda la BD", () => {
  assert.equal(bracketIdFor("solo-shuffle", requireSpec("mage", "frost")), "shuffle-mage-frost");
  // El slug compuesto se aplasta por el camino, y solo el catálogo lo sabe.
  assert.equal(
    bracketIdFor("solo-shuffle", requireSpec("death-knight", "frost")),
    "shuffle-deathknight-frost",
  );
});

test("el MVP publica una sola modalidad", () => {
  // §25 del plan: una modalidad. Ampliar la lista es abrir rutas nuevas, no
  // cambiar una constante, así que conviene que rompa aquí.
  assert.deepEqual([...BRACKET_SLUGS], ["solo-shuffle"]);
});

test("una ruta de perfil ya canónica se sirve tal cual", () => {
  const resolution = resolvePlayerRoute({
    region: "eu",
    realm: "twisting-nether",
    name: "ánatorey",
  });
  assert.deepEqual(resolution, {
    status: "canonical",
    route: { region: "eu", realmSlug: "twisting-nether", nameSlug: "ánatorey" },
  });
});

test("las mayúsculas de un perfil redirigen a la forma canónica", () => {
  const resolution = resolvePlayerRoute({
    region: "EU",
    realm: "Twisting-Nether",
    name: "Ánatorey",
  });
  assert.equal(resolution.status, "redirect");
  assert.equal(
    resolution.status === "redirect" ? decodeURIComponent(resolution.path) : "",
    "/player/eu/twisting-nether/ánatorey",
  );
});

test("un tramo escapado es el mismo tramo", () => {
  // Los tramos dinámicos llegan tal como viajan por la URL. Sin decodificar,
  // "ánatorey" no casa con su forma canónica y acaba redirigiendo a
  // "%25c3%25a1natorey", que ya no es nadie.
  assert.deepEqual(
    resolvePlayerRoute({ region: "eu", realm: "confr%C3%A9rie-du-thorium", name: "%C3%A1natorey" }),
    {
      status: "canonical",
      route: { region: "eu", realmSlug: "confrérie-du-thorium", nameSlug: "ánatorey" },
    },
  );

  // El "+" del tramo abierto viaja escapado desde cualquier sitio que lo copie.
  assert.deepEqual(
    resolveSpecRoute({ spec: "frost-mage", bracket: "solo-shuffle", segment: "3000%2B" }),
    { status: "redirect", path: "/spec/frost-mage/solo-shuffle/3000-plus" },
  );
});

test("un escape roto no se corrige, se rechaza", () => {
  assert.equal(resolveSpecRoute({ spec: "frost-mage%zz" }).status, "unknown");
});

test("los acentos de un nombre no se canonicalizan a nada", () => {
  // Hay 1.424 grupos de personajes distintos que solo se diferencian en los
  // acentos (ADR 0017): redirigir uno al otro los fundiría en la misma página.
  const resolution = resolvePlayerRoute({
    region: "eu",
    realm: "magtheridon",
    name: "arthaslegend",
  });
  assert.deepEqual(resolution, {
    status: "canonical",
    route: { region: "eu", realmSlug: "magtheridon", nameSlug: "arthaslegend" },
  });
});

test("una región que no existe no es un perfil que redirigir", () => {
  assert.equal(
    resolvePlayerRoute({ region: "es", realm: "sanguino", name: "ánatorey" }).status,
    "unknown",
  );
  assert.equal(isRegion("es"), false);
  assert.equal(isRegion("eu"), true);
});

test("los tres niveles de spec se resuelven con lo que trae la URL", () => {
  const frost = requireSpec("mage", "frost");

  assert.deepEqual(resolveSpecRoute({ spec: "frost-mage" }), {
    status: "canonical",
    route: { spec: frost, bracket: undefined, segment: undefined },
  });
  assert.deepEqual(resolveSpecRoute({ spec: "frost-mage", bracket: "solo-shuffle" }), {
    status: "canonical",
    route: { spec: frost, bracket: "solo-shuffle", segment: undefined },
  });
  assert.deepEqual(
    resolveSpecRoute({ spec: "frost-mage", bracket: "solo-shuffle", segment: "2000-2200" }),
    {
      status: "canonical",
      route: { spec: frost, bracket: "solo-shuffle", segment: segmentFor(2000) },
    },
  );
});

test("una spec en mayúsculas redirige en vez de duplicar la página", () => {
  assert.deepEqual(resolveSpecRoute({ spec: "Frost-Mage", bracket: "Solo-Shuffle" }), {
    status: "redirect",
    path: "/spec/frost-mage/solo-shuffle",
  });
});

test("el tramo abierto escrito con + redirige a su slug", () => {
  // Es lo que teclea quien ha leído "3000+" en la pantalla, y la página se lo
  // enseña con esa forma.
  assert.deepEqual(
    resolveSpecRoute({ spec: "frost-mage", bracket: "solo-shuffle", segment: "3000+" }),
    { status: "redirect", path: "/spec/frost-mage/solo-shuffle/3000-plus" },
  );
});

test("lo que no está en el catálogo no es una ruta", () => {
  assert.equal(resolveSpecRoute({ spec: "mage-frost" }).status, "unknown");
  assert.equal(resolveSpecRoute({ spec: "frost-mage", bracket: "2v2" }).status, "unknown");
  assert.equal(
    resolveSpecRoute({ spec: "frost-mage", bracket: "solo-shuffle", segment: "2010-2190" }).status,
    "unknown",
  );
});

test("la ruta de metodología no depende de ningún dato", () => {
  // Es obligatoria desde el MVP (§24) y no tiene tramos dinámicos que resolver.
  assert.equal(METHODOLOGY_PATH, "/methodology");
});

test("un apartado de la metodología se enlaza por su nombre, no por un ancla escrita a mano", () => {
  assert.equal(methodologyPath(), METHODOLOGY_PATH);
  assert.equal(methodologyPath("confidence"), "/methodology#confidence");
});

test("el catálogo de apartados no tiene nombres repetidos", () => {
  // Dos apartados con el mismo `id` son un enlace que aterriza en el primero de
  // los dos y nadie se entera: el navegador no avisa, se lee otra cosa.
  assert.equal(new Set(METHODOLOGY_SECTIONS).size, METHODOLOGY_SECTIONS.length);
});

test("la búsqueda lleva lo tecleado en la query, no en la ruta", () => {
  // Reino y nombre aquí no nombran a nadie todavía: son lo que se escribió, que
  // puede no existir. Una ruta afirmaría una identidad sin resolver.
  assert.equal(
    searchPath({ realm: "sanguino", name: "ánatorey" }),
    `${SEARCH_PATH}?realm=sanguino&name=%C3%A1natorey`,
  );
});

test("el resultado de un envío viaja en la URL, no se vuelve a averiguar", () => {
  // Es lo que evita que refrescar /search gaste otra llamada a Blizzard.
  assert.equal(
    searchPath({ realm: "sanguino", name: "anatorey", status: "not-found" }),
    `${SEARCH_PATH}?realm=sanguino&name=anatorey&status=not-found`,
  );
  assert.ok(isSearchStatus("unavailable"));
  assert.ok(isSearchStatus("rate-limited"));
  assert.ok(!isSearchStatus("not_found"));
});
