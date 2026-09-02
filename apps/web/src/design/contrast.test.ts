import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { CLASS_SLUGS } from "@wowpvp/core";

import { contrastRatio, darkTheme, lightTheme, scale } from "./contrast";

const CSS = readFileSync(fileURLToPath(new URL("../app/globals.css", import.meta.url)), "utf8");

/** AA para texto normal. El producto no usa texto grande para nada informativo. */
const AA_TEXT = 4.5;
/** AA para información no textual: el anillo de foco. */
const AA_NON_TEXT = 3;

const THEMES = [
  { name: "oscuro", tokens: darkTheme(CSS) },
  { name: "claro", tokens: lightTheme(CSS) },
] as const;

/**
 * Todas las superficies sobre las que puede caer texto.
 *
 * Son seis nombres y no tres porque el vocabulario de shadcn los distingue, no
 * porque se pinten distinto: hoy varios comparten valor. Se enumeran los seis
 * para que separarlos algún día no deje ninguno sin verificar.
 */
const SURFACES = [
  "--background",
  "--card",
  "--popover",
  "--secondary",
  "--muted",
  "--accent",
] as const;

const TEXT_TOKENS = [
  "--foreground",
  "--muted-foreground",
  "--subtle-foreground",
  "--primary",
  "--destructive",
] as const;

const QUALITY_TOKENS = [
  "--quality-poor",
  "--quality-common",
  "--quality-uncommon",
  "--quality-rare",
  "--quality-epic",
  "--quality-legendary",
  "--quality-artifact",
] as const;

/**
 * Un token por clase, derivado del catálogo y no escrito a mano: una clase
 * nueva en `CLASS_SLUGS` hace fallar este test por token ausente, que es
 * justo lo que tiene que pasar antes de que se pinte sin color.
 */
const CLASS_TOKENS = CLASS_SLUGS.map((slug) => `--class-${slug}`);

/**
 * Los pares de la gramática de shadcn: un relleno y el texto que va encima.
 *
 * Es la mitad que el bucle de superficies no puede cubrir, porque ahí se
 * verifica texto sobre fondo de página y aquí texto sobre un relleno de color.
 * Cada par se declara junto en `globals.css` y se rompe junto.
 */
const FILL_PAIRS = [
  ["--primary", "--primary-foreground"],
  ["--destructive", "--destructive-foreground"],
  ["--warning", "--warning-foreground"],
  ["--card", "--card-foreground"],
  ["--popover", "--popover-foreground"],
  ["--secondary", "--secondary-foreground"],
  ["--accent", "--accent-foreground"],
] as const;

function color(tokens: Map<string, string>, name: string): string {
  const value = tokens.get(name);
  assert.ok(value !== undefined, `Falta el token ${name}`);
  return value;
}

for (const { name, tokens } of THEMES) {
  describe(`tema ${name}`, () => {
    // Cada token de texto se verifica contra TODAS las superficies, no solo
    // contra la que se tenía en mente al elegirlo: un color que solo pasa sobre
    // `card` obliga a una regla de "úsalo únicamente aquí" que nadie recuerda
    // al maquetar el tercer componente.
    for (const token of [...TEXT_TOKENS, ...QUALITY_TOKENS, ...CLASS_TOKENS]) {
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

    for (const [fill, foreground] of FILL_PAIRS) {
      it(`${foreground} cumple AA sobre ${fill}`, () => {
        const ratio = contrastRatio(color(tokens, foreground), color(tokens, fill));
        assert.ok(
          ratio >= AA_TEXT,
          `${foreground} sobre ${fill}: ${ratio.toFixed(2)}, se necesita ${AA_TEXT}`,
        );
      });
    }

    it("el anillo de foco se distingue de todas las superficies", () => {
      for (const surface of SURFACES) {
        const ratio = contrastRatio(color(tokens, "--ring"), color(tokens, surface));
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
      assert.equal(color(tokens, "--quality-common"), color(tokens, "--foreground"));
    });

    // Misma decisión y por la misma razón: el blanco de priest solo llega a AA
    // sobre fondo claro convertido en un gris que no identifica a nadie, y que
    // además coincide con `quality-poor`. Un color de clase que no distingue la
    // clase no es un color de clase.
    it("la clase `priest` es el color de texto del tema", () => {
      assert.equal(color(tokens, "--class-priest"), color(tokens, "--foreground"));
    });

    // El aviso de muestra reducida no es un error (ADR 0003), y por eso tiene
    // token propio en vez de reutilizar `destructive`. Compartir valor sería
    // tenerlo de nombre y no de hecho.
    it("el aviso de muestra reducida no se pinta como un error", () => {
      assert.notEqual(color(tokens, "--warning-foreground"), color(tokens, "--destructive"));
    });
  });
}

describe("los dos temas", () => {
  // El fondo de hover de shadcn tiene que verse sobre la superficie donde se
  // pinta, que es la tarjeta y el flotante. Igualarlos —que es lo que valía el
  // tema claro antes del ADR 0025— deja el resaltado de la opción activa
  // invisible sin que falle nada más.
  for (const { name, tokens } of THEMES) {
    it(`el resaltado se distingue de la tarjeta en el tema ${name}`, () => {
      assert.notEqual(color(tokens, "--accent"), color(tokens, "--card"));
    });
  }
});

describe("escala tipográfica", () => {
  // La §4.3 del brief exige que la línea de atribución sea "texto de cuerpo, no
  // letra pequeña". Se cumple no teniendo con qué incumplirlo: el paso más
  // pequeño del sistema es 14px.
  it("no hay ningún paso por debajo de 14px", () => {
    const sizes = [...scale(CSS)]
      .filter(([name]) => /^--text-[a-z0-9]+$/.test(name))
      .map(([name, value]) => [name, Number.parseFloat(value)] as const);

    assert.ok(sizes.length >= 6, "Se esperaban al menos seis pasos en la escala");
    for (const [name, rem] of sizes) {
      assert.ok(rem >= 0.875, `${name} vale ${rem}rem, por debajo del suelo de 0.875rem (14px)`);
    }
  });
});
