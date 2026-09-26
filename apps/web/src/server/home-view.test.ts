import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ALL_SPECS, HIGH_RATING_FLOOR, MIN_SAMPLE_MEDIUM } from "@wowpvp/core";
import type { BracketPopulation, RunPopulationRead } from "@wowpvp/data";

import { ALL_SPEC_ROWS, representationFor } from "./home-view";

const COMPUTED_AT = new Date("2026-09-18T04:00:00Z");

/** Un bracket con su población repartida entre un tramo de abajo y uno de arriba. */
function bracketOf(bracket: string, below: number, high: number): BracketPopulation {
  return {
    bracket,
    population: below + high,
    segments: [
      { segmentMin: 1800, population: below },
      { segmentMin: HIGH_RATING_FLOOR, population: high },
    ],
  };
}

function run(brackets: BracketPopulation[]): RunPopulationRead {
  return { seasonId: 42, computedAt: COMPUTED_AT, brackets };
}

describe("representationFor", () => {
  it("reparte la modalidad entre sus specs, de mayor a menor", () => {
    const board = representationFor(
      run([
        bracketOf("shuffle-mage-frost", 300, 100),
        bracketOf("shuffle-warrior-arms", 100, 0),
        bracketOf("shuffle-priest-holy", 400, 100),
      ]),
    );

    assert.equal(board?.observed, 1000);
    assert.equal(board?.specs, 3);
    assert.deepEqual(
      board?.rows.map((row) => [row.spec.label, row.observed, row.share]),
      [
        ["Holy Priest", 500, 0.5],
        ["Frost Mage", 400, 0.4],
        ["Arms Warrior", 100, 0.1],
      ],
    );
  });

  it("el índice compara el peso de arriba con el peso en la modalidad", () => {
    const board = representationFor(
      run([bracketOf("shuffle-mage-frost", 300, 100), bracketOf("shuffle-priest-holy", 500, 100)]),
    );

    const frost = board?.rows.find((row) => row.spec.specSlug === "frost");
    assert.equal(board?.highObserved, 200);
    // 40 % de la modalidad y 50 % del tramo alto: pesa 1,25 veces más arriba.
    assert.equal(frost?.share, 0.4);
    assert.equal(frost?.high?.share, 0.5);
    assert.equal(frost?.high?.index, 1.25);
  });

  it("una spec sin muestra suficiente arriba no publica ni proporción ni índice", () => {
    const board = representationFor(
      run([
        bracketOf("shuffle-mage-frost", 300, MIN_SAMPLE_MEDIUM - 1),
        bracketOf("shuffle-priest-holy", 300, MIN_SAMPLE_MEDIUM),
      ]),
    );

    // El corte es la muestra de cada spec arriba, no la población del bracket:
    // las dos tienen 300 personajes observados, y solo una de ellas puede decir
    // qué parte del tramo alto es suya.
    assert.equal(board?.rows.find((row) => row.spec.specSlug === "frost")?.high, null);
    assert.ok(board?.rows.find((row) => row.spec.specSlug === "holy")?.high);
  });

  it("sin nadie arriba no hay proporción del tramo alto para nadie", () => {
    const board = representationFor(
      run([bracketOf("shuffle-mage-frost", 500, 0), bracketOf("shuffle-priest-holy", 400, 0)]),
    );

    assert.equal(board?.highObserved, 0);
    assert.deepEqual(
      board?.rows.map((row) => row.high),
      [null, null],
    );
  });

  it("un bracket que no es una spec del catálogo no entra en el total", () => {
    const board = representationFor(
      run([bracketOf("shuffle-overall", 9000, 900), bracketOf("shuffle-mage-frost", 300, 100)]),
    );

    // Con el agregado dentro, la spec pesaría un 4 % en vez de todo lo que hay.
    assert.equal(board?.observed, 400);
    assert.equal(board?.specs, 1);
    assert.equal(board?.rows[0]?.share, 1);
  });

  it("solo salen las que caben en la portada", () => {
    const board = representationFor(
      run([
        bracketOf("shuffle-mage-frost", 500, 0),
        bracketOf("shuffle-priest-holy", 400, 0),
        bracketOf("shuffle-warrior-arms", 300, 0),
      ]),
      { limit: 2 },
    );

    assert.equal(board?.rows.length, 2);
    // El total sigue siendo el de la modalidad entera: recortar la tabla no
    // puede cambiar el denominador de las que salen.
    assert.equal(board?.observed, 1200);
    assert.equal(board?.specs, 3);
  });

  it("dos specs igualadas salen siempre en el mismo orden", () => {
    const board = representationFor(
      run([bracketOf("shuffle-priest-holy", 500, 0), bracketOf("shuffle-mage-frost", 500, 0)]),
    );
    const other = representationFor(
      run([bracketOf("shuffle-mage-frost", 500, 0), bracketOf("shuffle-priest-holy", 500, 0)]),
    );

    assert.deepEqual(
      board?.rows.map((row) => row.spec.label),
      other?.rows.map((row) => row.spec.label),
    );
  });

  it("una spec sin nadie observado no ocupa una fila de ceros", () => {
    const board = representationFor(
      run([bracketOf("shuffle-mage-frost", 500, 0), bracketOf("shuffle-priest-holy", 0, 0)]),
    );

    assert.equal(board?.rows.length, 1);
    assert.equal(board?.specs, 1);
  });

  it("el tramo mediano es el de la población acumulada, no el más poblado", () => {
    const board = representationFor(
      run([
        {
          bracket: "shuffle-mage-frost",
          population: 100,
          segments: [
            { segmentMin: 1400, population: 45 },
            { segmentMin: 1600, population: 10 },
            { segmentMin: 1800, population: 45 },
          ],
        },
      ]),
    );

    // 1600-1800 tiene diez personas y es donde cae la de en medio: el acumulado
    // pasa de la mitad ahí. El tramo más poblado empata en 45 y no decide nada.
    assert.equal(board?.rows[0]?.medianSegment?.id, "1600-1800");
  });

  it("el tramo mediano sigue saliendo aunque la spec no tenga muestra arriba", () => {
    const board = representationFor(
      run([bracketOf("shuffle-mage-frost", 300, MIN_SAMPLE_MEDIUM - 1)]),
    );

    // Las dos cifras del tramo alto se caen juntas; la mediana no cuelga de esa
    // base, describe a toda la población de la spec.
    assert.equal(board?.rows[0]?.high, null);
    assert.equal(board?.rows[0]?.medianSegment?.id, "1800-2000");
  });

  it("el recorte de la página del meta no deja fuera ninguna spec del catálogo", () => {
    // Es el catálogo y no un número escrito: una spec nueva entra sola.
    assert.equal(ALL_SPEC_ROWS, ALL_SPECS.length);

    const board = representationFor(
      run([
        bracketOf("shuffle-mage-frost", 500, 0),
        bracketOf("shuffle-priest-holy", 400, 0),
        bracketOf("shuffle-warrior-arms", 300, 0),
      ]),
      { limit: ALL_SPEC_ROWS },
    );

    assert.equal(board?.rows.length, 3);
  });

  it("sin corrida, y con una corrida sin nadie, no hay reparto", () => {
    assert.equal(representationFor(null), null);
    assert.equal(representationFor(run([])), null);
    assert.equal(representationFor(run([bracketOf("shuffle-mage-frost", 0, 0)])), null);
  });
});
