import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCount,
  formatDate,
  formatPercent,
  formatPercentile,
  formatRating,
  formatShare,
} from "./format";

test("el separador de miles es el de la lengua de la página", () => {
  assert.equal(formatCount(2282, "es"), "2282");
  assert.equal(formatCount(22820, "es"), "22.820");
  assert.equal(formatCount(22820, "en"), "22,820");
});

test("una cifra del juego no lleva separador de miles en ninguna lengua", () => {
  // "2,600+" en inglés al lado de un tramo escrito "2400-2600" se lee como dos
  // cifras de cosas distintas, y el tramo es el que manda: es el de la URL.
  assert.equal(formatRating(2600, "en"), "2600");
  assert.equal(formatRating(2600, "es"), "2600");
  assert.equal(formatCount(2600, "en"), "2,600");
});

test("el percentil se trunca y no se redondea", () => {
  // Redondear haría "percentil 100" de un 99,98, y no hay percentil 100: quien
  // está arriba del todo no está por debajo de sí mismo.
  assert.equal(formatPercentile(99.98, "en"), "99");
  assert.equal(formatPercentile(70.02, "es"), "70");
});

test("la fecha de una observación va sin hora", () => {
  const observed = new Date("2026-08-29T03:38:01Z");

  assert.doesNotMatch(formatDate(observed, "es"), /\d+:\d+/);
  assert.match(formatDate(observed, "en"), /2026/);
});

test("el porcentaje de adopción se escribe en la lengua de la página", () => {
  // El español separa el signo del número y el inglés no. Es lo mismo que pasa
  // con el separador de miles: si se deja a `toLocaleString()` sin idioma, se
  // cuela el del servidor.
  assert.equal(formatPercent(0.41, "en"), "41%");
  // El espacio es duro: `Intl` no deja que el signo caiga solo a la línea
  // siguiente, y escribirlo aquí como uno normal haría fallar el test sin que
  // se vea la diferencia.
  assert.equal(formatPercent(0.41, "es"), "41 %");
});

test("una proporción de población lleva un decimal, y un tramo pequeño no sale a cero", () => {
  // El espacio es duro, igual que en el porcentaje de adopción.
  assert.equal(formatShare(0.046, "es"), "4,6 %");
  assert.equal(formatShare(0.046, "en"), "4.6%");
  // 18 de 4.412: con el formato de la adopción se leería "0 %" de un tramo que
  // tiene gente.
  assert.equal(formatShare(18 / 4412, "en"), "0.4%");
});

test("no se inventan decimales que la muestra no sostiene", () => {
  // La fracción cruda va siempre al lado, así que el porcentaje es la lectura
  // rápida y no la cifra que manda.
  assert.equal(formatPercent(128 / 312, "en"), "41%");
});
