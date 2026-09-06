import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LOCALES } from "../locales";
import { allPhrases } from "../voice";
import { legalFor } from "./index";

/*
 * Lo que este documento **no** hereda de `voice.ts` es el guardián causal, y no
 * es un olvido: una política de privacidad no es copy de datos y no cuelga de
 * ninguna cifra (ver la cabecera de `legal/index.ts`). Lo que sí comparte es el
 * recorrido, que era idéntico escrito dos veces.
 */

describe("la política de privacidad", () => {
  it("no deja ninguna frase vacía en ninguna de las dos lenguas", () => {
    for (const locale of LOCALES) {
      for (const { key, text } of allPhrases(legalFor(locale))) {
        assert.ok(text.trim().length > 0, `Frase vacía en "${locale}": ${key}`);
      }
    }
  });

  it("tiene el mismo número de párrafos en cada apartado y en las dos lenguas", () => {
    // El tipo garantiza que estén los mismos apartados, no que digan lo mismo.
    // Un párrafo que se cae al traducir es una obligación que se cumple en un
    // idioma y no en el otro, y no lo diría nadie.
    const en = allPhrases(legalFor("en")).map((phrase) => phrase.key);
    const es = allPhrases(legalFor("es")).map((phrase) => phrase.key);
    assert.deepEqual(es, en);
  });

  /*
   * Lo que sigue son obligaciones externas, no preferencias de redacción: la
   * 2.k, la 2.p y la 2.s de la ToU de Blizzard (ADR 0015, decisión 9) y el
   * derecho de supresión con el que la última se implementa. Se comprueban por
   * la misma razón que la línea de atribución: una obligación contractual no
   * puede quedar sujeta a que nadie reescriba un párrafo.
   */
  it("declara los datos «tal cual», que es lo que exige la 2.k", () => {
    assert.match(legalFor("en").site.paragraphs[1] ?? "", /"as is"/);
    assert.match(legalFor("es").site.paragraphs[1] ?? "", /«tal cual»/);
  });

  it("se declara consistente con la política de Blizzard, que es la 2.p", () => {
    assert.match(
      legalFor("en").character.paragraphs.join(" "),
      /alongside Blizzard's own privacy policy/,
    );
    assert.match(
      legalFor("es").character.paragraphs.join(" "),
      /política de privacidad de Blizzard/,
    );
  });

  it("dice el ciclo de treinta días y el borrado, que son la 2.s", () => {
    for (const locale of LOCALES) {
      const text = legalFor(locale).character.paragraphs.join(" ");
      assert.match(text, /thirty days|treinta días/);
      assert.match(text, /deleted|borra/);
    }
  });

  it("dice cómo se ejerce la supresión y ante quién se reclama", () => {
    for (const locale of LOCALES) {
      const text = legalFor(locale).rights.paragraphs.join(" ");
      assert.match(text, /delete it|suprimamos/);
      assert.match(text, /complaint|reclamación/);
    }
  });

  it("nombra la única petición a un tercero que hace el navegador", () => {
    // Los iconos se sirven desde el CDN de Blizzard y no se re-alojan (ADR 0015,
    // decisión 7). Es la excepción a "cero terceros" y callarla la convertiría
    // en una afirmación falsa.
    for (const locale of LOCALES) {
      assert.match(legalFor(locale).thirdParties.paragraphs.join(" "), /Blizzard/);
    }
  });
});
