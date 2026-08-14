import assert from "node:assert/strict";
import { test } from "node:test";
import { takeSample } from "./sampling";

const population = Array.from({ length: 500 }, (_, i) => `char-${i}`);

test("la misma semilla da la misma muestra (un hallazgo tiene que ser auditable)", () => {
  const a = takeSample(population, 100, "issue-8");
  const b = takeSample(population, 100, "issue-8");
  assert.deepEqual(a, b);
});

test("semillas distintas dan muestras distintas", () => {
  const a = takeSample(population, 100, "issue-8");
  const b = takeSample(population, 100, "otra-semilla");
  assert.notDeepEqual(a, b);
});

test("la muestra no repite elementos", () => {
  const sample = takeSample(population, 100, "issue-8");
  assert.equal(sample.length, 100);
  assert.equal(new Set(sample).size, 100);
});

test("no muestrea 'los primeros del ranking': el orden de entrada no se conserva", () => {
  // Si la muestra fuese el prefijo de la población ordenada, el sesgo hacia la
  // parte alta del bucket se colaría en cualquier adoption_rate posterior.
  const sample = takeSample(population, 100, "issue-8");
  assert.notDeepEqual(sample, population.slice(0, 100));
});

test("un bucket más corto que el tope devuelve todo lo que hay, sin rellenar", () => {
  // El caso de Frost Mage en 1800-2000 (#6): el hueco es el dato.
  const short = population.slice(0, 12);
  const sample = takeSample(short, 100, "issue-8");
  assert.equal(sample.length, 12);
  assert.deepEqual([...sample].sort(), [...short].sort());
});

test("limit <= 0 es censo: la población entera", () => {
  assert.equal(takeSample(population, 0, "issue-8").length, population.length);
  assert.equal(takeSample(population, -1, "issue-8").length, population.length);
});

test("no muta la población de entrada", () => {
  const original = [...population];
  takeSample(population, 50, "issue-8");
  assert.deepEqual(population, original);
});
