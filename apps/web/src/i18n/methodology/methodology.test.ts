import { MIN_DISCRIMINATIVE_DELTA, MIN_SAMPLE_HIGH, MIN_SAMPLE_MEDIUM } from "@wowpvp/core";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOCALES } from "../locales";
import { CAUSAL_PATTERNS, allPhrases } from "../voice";
import { methodologyFor } from "./index";

describe("la página de metodología", () => {
  it("no deja ninguna frase vacía en ninguna de las dos lenguas", () => {
    for (const locale of LOCALES) {
      for (const { key, text } of allPhrases(methodologyFor(locale))) {
        assert.ok(text.trim().length > 0, `Frase vacía en "${locale}": ${key}`);
      }
    }
  });

  it("tiene el mismo número de párrafos en cada apartado y en las dos lenguas", () => {
    // El tipo garantiza que estén los mismos apartados, no que digan lo mismo.
    // Un párrafo que se cae al traducir es una explicación que existe en un
    // idioma y no en el otro, y no lo diría nadie.
    const en = allPhrases(methodologyFor("en")).map((phrase) => phrase.key);
    const es = allPhrases(methodologyFor("es")).map((phrase) => phrase.key);
    assert.deepEqual(es, en);
  });

  it("no recomienda nada, que es lo que viene a sostener", () => {
    // Aquí no hay claves exentas y no puede haberlas: la excepción de voz de
    // `copy.test.ts` es de la portada, que no cuelga de ninguna cifra (§3.8 del
    // brief). Esta página cuelga de todas.
    for (const locale of LOCALES) {
      for (const { key, text } of allPhrases(methodologyFor(locale))) {
        for (const pattern of CAUSAL_PATTERNS[locale]) {
          assert.doesNotMatch(text, pattern, `Texto causal en "${locale}" (${key}): "${text}"`);
        }
      }
    }
  });

  /*
   * Lo que sigue son obligaciones externas y cifras del dominio, no preferencias
   * de redacción. Se comprueban por la misma razón que las de la política de
   * privacidad: una obligación contractual no puede quedar sujeta a que nadie
   * reescriba un párrafo.
   */
  it("identifica a Blizzard como fuente del dato, que es la otra mitad de la 2.m", () => {
    // Esta comprobación estaba en `copy.test.ts`, sobre la línea del pie, hasta
    // que la §4.2 del brief retiró de ahí la frase de procedencia y la mandó a
    // esta página. Se muda con ella; si no, la obligación se queda sin test.
    for (const locale of LOCALES) {
      const sources = methodologyFor(locale).sections.sources.paragraphs.join(" ");
      assert.match(sources, /Blizzard® Developer APIs/);
      assert.match(sources, /Blizzard Entertainment, Inc\./);
      // El símbolo va en la primera aparición de cada marca (ADR 0015,
      // decisión 8), y este apartado es la primera de la página.
      assert.match(sources, /World of Warcraft®/);
    }
  });

  it("dice el tope del leaderboard, que es el límite de la población observada", () => {
    // Sin esta cifra, "observado" se lee como "todo el mundo", que es la mentira
    // fácil de este producto (§2.5 del brief). Con el separador de cada lengua.
    assert.match(methodologyFor("en").sections.observed.paragraphs.join(" "), /5,000/);
    assert.match(methodologyFor("es").sections.observed.paragraphs.join(" "), /5\.000/);
  });

  it("dice los umbrales que decide el dominio, no unos escritos a mano", () => {
    // Los párrafos los interpola `methodologyThresholds()` desde
    // `@wowpvp/core`, así que lo que esto vigila es que sigan nombrados: una
    // reescritura que se lleve por delante el "100" deja la página explicando
    // una confianza sin cifras.
    for (const locale of LOCALES) {
      const sections = methodologyFor(locale).sections;
      const confidence = sections.confidence.paragraphs.join(" ");
      assert.ok(confidence.includes(String(MIN_SAMPLE_HIGH)), `Falta el umbral alto en ${locale}`);
      assert.ok(confidence.includes(String(MIN_SAMPLE_MEDIUM)), `Falta el medio en ${locale}`);

      const points = String(Math.round(MIN_DISCRIMINATIVE_DELTA * 100));
      assert.ok(
        sections.numbers.paragraphs.join(" ").includes(points),
        `Falta el umbral discriminante en ${locale}`,
      );
    }
  });
});
