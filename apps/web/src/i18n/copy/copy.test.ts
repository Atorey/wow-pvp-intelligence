import assert from "node:assert/strict";
import { test } from "node:test";

import { LOCALES } from "../locales";
import { copyFor } from "./index";

/**
 * Todas las frases de un diccionario, con las plantillas ya resueltas.
 *
 * Las claves las garantiza el tipo (`Copy` es `typeof en`), así que lo que
 * queda por comprobar son los valores, y para eso hay que ejecutar las
 * funciones: una regla de copy no se cumple en la plantilla, se cumple en la
 * frase montada.
 */
function allPhrases(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    // Argumentos que no aportan palabras propias: lo que se revisa es lo que
    // pone la plantilla alrededor, no lo que se le inyecta.
    return allPhrases((value as (...args: string[]) => string)("A", "B", "C"));
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).flatMap(allPhrases);
  }
  return [];
}

test("ninguna clave se queda sin frase en ninguna de las dos lenguas", () => {
  for (const locale of LOCALES) {
    for (const phrase of allPhrases(copyFor(locale))) {
      assert.ok(phrase.trim().length > 0, `Frase vacía en "${locale}".`);
    }
  }
});

test("la línea de atribución dice las tres cosas que la cláusula pide", () => {
  // La 2.m de la ToU obliga a identificar la fuente y a negar el respaldo, y la
  // §4.2 del brief añade las marcas. Una versión corta que quepa mejor en el pie
  // incumple el requisito, así que la longitud no es negociable.
  const en = copyFor("en").attribution;
  assert.match(en, /Blizzard® Developer APIs/);
  assert.match(en, /not affiliated with, endorsed by, or sponsored by/);
  assert.match(en, /trademarks of Blizzard Entertainment, Inc\./);

  const es = copyFor("es").attribution;
  assert.match(es, /Blizzard® Developer APIs/);
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

test("el copy no recomienda nada en ninguna de las dos lenguas", () => {
  for (const locale of LOCALES) {
    const patterns = CAUSAL_PATTERNS[locale] ?? [];
    for (const phrase of allPhrases(copyFor(locale))) {
      for (const pattern of patterns) {
        assert.doesNotMatch(phrase, pattern, `Copy causal en "${locale}": "${phrase}"`);
      }
    }
  }
});
