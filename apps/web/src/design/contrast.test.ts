import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { contrastRatio, darkTheme, lightTheme } from "./contrast";

const CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

/** AA para texto normal. El producto no usa texto grande para nada informativo. */
const AA_TEXT = 4.5;
/** AA para información no textual: el anillo de foco. */
const AA_NON_TEXT = 3;

const THEMES = [
  { name: "oscuro", tokens: darkTheme(CSS) },
  { name: "claro", tokens: lightTheme(CSS) },
] as const;

/** Las tres superficies sobre las que puede caer texto en cualquier pantalla. */
const SURFACES = ["--color-bg", "--color-surface", "--color-raised"] as const;

const TEXT_TOKENS = [
  "--color-ink",
  "--color-ink-secondary",
  "--color-ink-muted",
  "--color-accent",
] as const;

const QUALITY_TOKENS = [
  "--color-quality-poor",
  "--color-quality-common",
  "--color-quality-uncommon",
  "--color-quality-rare",
  "--color-quality-epic",
  "--color-quality-legendary",
  "--color-quality-artifact",
] as const;

function color(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  assert.ok(value !== undefined, `Falta el token ${name}`);
  return value;
}

for (const { name, tokens } of THEMES) {
  describe(`tema ${name}`, () => {
    // Cada token de texto se verifica contra las TRES superficies, no solo
    // contra la que se tenía en mente al elegirlo: un color que solo pasa sobre
    // `surface` obliga a una regla de "úsalo únicamente aquí" que nadie recuerda
    // al maquetar el tercer componente.
    for (const token of [...TEXT_TOKENS, ...QUALITY_TOKENS]) {
      for (const surface of SURFACES) {
        it(`${token} sobre ${surface} cumple AA`, () => {
          const ratio = contrastRatio(color(tokens, token), color(tokens, surface));
          assert.ok(
            ratio >= AA_TEXT,
            `${token} sobre ${surface}: ${ratio.toFixed(2)}, se necesita ${AA_TEXT}`,
          );
        });
      }
    }

    it("el texto del aviso cumple AA sobre la superficie del aviso", () => {
      const ratio = contrastRatio(
        color(tokens, "--color-warn"),
        color(tokens, "--color-warn-surface"),
      );
      assert.ok(ratio >= AA_TEXT, `aviso: ${ratio.toFixed(2)}, se necesita ${AA_TEXT}`);
    });

    it("el anillo de foco se distingue de las tres superficies", () => {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(color(tokens, "--color-focus"), color(tokens, surface));
        assert.ok(
          ratio >= AA_NON_TEXT,
          `foco sobre ${surface}: ${ratio.toFixed(2)}, se necesita ${AA_NON_TEXT}`,
        );
      }
    });

    // `common` es la ausencia de tinte, no un gris elegido: un item común se
    // lee con el color de texto del tema. Si se separan, la escala de calidad
    // pasa a tener siete colores en vez de seis y una excepción que explicar.
    it("la calidad `common` es el color de texto del tema", () => {
      assert.equal(color(tokens, "--color-quality-common"), color(tokens, "--color-ink"));
    });
  });
}

describe("escala tipográfica", () => {
  // La §4.3 del brief exige que la línea de atribución sea "texto de cuerpo, no
  // letra pequeña". Se cumple no teniendo con qué incumplirlo: el paso más
  // pequeño del sistema es 14px.
  it("no hay ningún paso por debajo de 14px", () => {
    const tokens = darkTheme(CSS);
    const sizes = [...tokens]
      .filter(([name]) => /^--text-[a-z0-9]+$/.test(name))
      .map(([name, value]) => [name, Number.parseFloat(value)] as const);

    assert.ok(sizes.length >= 6, "Se esperaban al menos seis pasos en la escala");
    for (const [name, rem] of sizes) {
      assert.ok(rem >= 0.875, `${name} vale ${rem}rem, por debajo del suelo de 0.875rem (14px)`);
    }
  });
});
