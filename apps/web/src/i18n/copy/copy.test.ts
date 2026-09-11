import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../locales";
import { CAUSAL_PATTERNS, allPhrases } from "../voice";
import { copyFor } from "./index";

test("ninguna clave se queda sin frase en ninguna de las dos lenguas", () => {
  for (const locale of LOCALES) {
    for (const { key, text } of allPhrases(copyFor(locale))) {
      assert.ok(text.trim().length > 0, `Frase vacía en "${locale}": ${key}`);
    }
  }
});

test("la línea de atribución dice las dos cosas que le quedan", () => {
  // Son dos y no tres desde que la §4.2 del brief retiró la frase de
  // procedencia: queda la negación de respaldo y quedan las marcas. Lo que se
  // verifica es que no se acorte más — una versión que quepa mejor en el pie
  // deja de negar lo que la 2.m obliga a negar.
  //
  // La identificación de la fuente no se comprueba aquí porque ya no está aquí:
  // vive en la página de metodología, y su test se mudó allí con ella
  // (`i18n/methodology/methodology.test.ts`).
  const en = copyFor("en").attribution;
  assert.match(en, /not affiliated with, endorsed by, or sponsored by/);
  assert.match(en, /trademarks of Blizzard Entertainment, Inc\./);

  const es = copyFor("es").attribution;
  assert.match(es, /no está afiliado .*ni cuenta con su respaldo ni con su patrocinio/);
  assert.match(es, /son marcas de Blizzard Entertainment, Inc\./);
});

test("el bloque de posición dice el tope del leaderboard en las dos lenguas", () => {
  // Mismo motivo que la línea de atribución: es una obligación externa (§14 del
  // plan pide la limitación "en la propia UI") y una obligación externa no puede
  // quedar sujeta a que nadie reescriba la frase. Se comprueba la cifra, que es
  // lo que no puede desaparecer, con el separador de cada lengua.
  assert.match(copyFor("en").player.standing.ladderCap, /5,000/);
  assert.match(copyFor("es").player.standing.ladderCap, /5\.000/);
  // La tabla por tramo de las páginas de spec la dice también: es la
  // distribución que ese corte recorta.
  assert.match(copyFor("en").spec.ladderCap, /5,000/);
  assert.match(copyFor("es").spec.ladderCap, /5\.000/);
});

/**
 * Las dos claves que quedan fuera, y por qué.
 *
 * El titular y el subtítulo de la portada son **voz de producto**, no copy de
 * datos. La §3.6 del brief acota su prohibición justo a eso —"el copy de
 * datos"—, y con razón: lo que la regla 3 del proyecto impide es que una cifra
 * observada se presente como la causa de un resultado ("el 74% del siguiente
 * segmento lleva X" nunca puede convertirse en "cambia X para subir"). Un
 * reclamo de portada que no cuelga de ninguna cifra no hace esa afirmación.
 *
 * La lista es de dos y se escribe entera a mano a propósito: no hay comodín, no
 * se exime una sección completa, y añadir una tercera clave obliga a escribir
 * aquí por qué. Todo lo demás —cada frase de la caja Player Gap, cada lectura
 * de spec, cada estado de confianza— sigue vigilado.
 */
const VOICE_EXEMPT: readonly string[] = ["home.title.lead", "home.subtitle"];

test("el copy no recomienda nada en ninguna de las dos lenguas", () => {
  for (const locale of LOCALES) {
    const patterns = CAUSAL_PATTERNS[locale];
    for (const { key, text } of allPhrases(copyFor(locale))) {
      if (VOICE_EXEMPT.includes(key)) continue;
      for (const pattern of patterns) {
        assert.doesNotMatch(text, pattern, `Copy causal en "${locale}" (${key}): "${text}"`);
      }
    }
  }
});

test("la exención de voz no cubre ninguna clave que no exista", () => {
  // Una clave exenta que se renombra deja de eximir a nada y no lo dice: la
  // frase pasa a estar vigilada sin que nadie lo decida. Aquí se entera.
  const keys = new Set(allPhrases(copyFor("en")).map((phrase) => phrase.key));
  for (const exempt of VOICE_EXEMPT) {
    assert.ok(keys.has(exempt), `La exención "${exempt}" no corresponde a ninguna clave.`);
  }
});
