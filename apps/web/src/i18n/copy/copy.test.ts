import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../locales";
import { copyFor } from "./index";

interface Phrase {
  /** La ruta de la clave, como se escribe al usarla: "home.meta.empty". */
  readonly key: string;
  readonly text: string;
}

/**
 * Todas las frases de un diccionario, con las plantillas ya resueltas y con su
 * clave al lado.
 *
 * Las claves las garantiza el tipo (`Copy` es `typeof en`), así que lo que
 * queda por comprobar son los valores, y para eso hay que ejecutar las
 * funciones: una regla de copy no se cumple en la plantilla, se cumple en la
 * frase montada.
 *
 * La ruta se arrastra por dos motivos: un fallo dice qué clave hay que tocar en
 * vez de obligar a buscar la frase, y las excepciones de voz de abajo se pueden
 * escribir por clave en lugar de por texto — una excepción escrita como "esta
 * frase concreta" deja de aplicar en cuanto alguien le cambia una coma, y lo
 * hace en silencio.
 */
function allPhrases(value: unknown, key = ""): Phrase[] {
  if (typeof value === "string") return [{ key, text: value }];
  if (typeof value === "function") {
    // Argumentos que no aportan palabras propias: lo que se revisa es lo que
    // pone la plantilla alrededor, no lo que se le inyecta.
    return allPhrases((value as (...args: string[]) => string)("A", "B", "C"), key);
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([name, nested]) =>
      allPhrases(nested, key ? `${key}.${name}` : name),
    );
  }
  return [];
}

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
  // La identificación de la fuente ya no se comprueba aquí porque ya no está
  // aquí. Vive en la página de metodología (#20) y allí no hay test que la
  // sostenga: cuando esa página se escriba, esta comprobación se muda con ella.
  const en = copyFor("en").attribution;
  assert.match(en, /not affiliated with, endorsed by, or sponsored by/);
  assert.match(en, /trademarks of Blizzard Entertainment, Inc\./);

  const es = copyFor("es").attribution;
  assert.match(es, /no está afiliado .*ni cuenta con su respaldo ni con su patrocinio/);
  assert.match(es, /son marcas de Blizzard Entertainment, Inc\./);
});

/**
 * Construcciones que convierten una correlación en un consejo. Salen de la §3.8
 * del brief, y el español lleva las suyas propias (§3.7) porque la finalidad se
 * cuela con "para" + infinitivo sin que suene a recomendación.
 *
 * Se verifica por lengua y no una vez, porque una traducción fluida puede
 * introducir causalidad donde el original no la tenía (ADR 0012, decisión 9).
 */
const CAUSAL_PATTERNS: Record<string, readonly RegExp[]> = {
  en: [
    /\b(change|try|pick|should|improve|boost)\b/i,
    /\braise your\b/i,
    /\b(best|optimal|definitive) (build|gear|talent)/i,
  ],
  es: [
    /\b(cambia|prueba|deberías|elige|mejora)\b/i,
    // "para" + infinitivo es finalidad, y la finalidad es causalidad.
    /\bpara\s+\w+(ar|er|ir)\b/i,
    /\b(mejor|óptim\w+) (build|gear|talento)/i,
  ],
};

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
    const patterns = CAUSAL_PATTERNS[locale] ?? [];
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
