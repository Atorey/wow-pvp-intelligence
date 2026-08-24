import assert from "node:assert/strict";
import { test } from "node:test";
import {
  foldSlug,
  formatCharacterRef,
  nameSlug,
  parseCharacterRef,
  realmSlug,
  resolveByFold,
} from "./characters";

// --- nameSlug ---

test("nameSlug pasa a minúsculas y recorta", () => {
  assert.equal(nameSlug("  Anatorey "), "anatorey");
});

test("nameSlug conserva los acentos", () => {
  // No es un olvido: es la forma con la que responde Blizzard, la que su API
  // acepta en la ruta, y la única que distingue a los cuatro personajes
  // distintos que hay en Magtheridon llamados Arthaslegend con acentos
  // diferentes. Plegarla aquí fundiría sus históricos en uno.
  assert.equal(nameSlug("Ánatorey"), "ánatorey");
  assert.equal(nameSlug("ARTHÁSLEGEND"), "artháslegend");
});

test("nameSlug conserva lo que no es latino", () => {
  assert.equal(nameSlug("Рейзаксия"), "рейзаксия");
});

// --- realmSlug ---

test("realmSlug reproduce la forma de Blizzard", () => {
  assert.equal(realmSlug("Twisting Nether"), "twisting-nether");
  assert.equal(realmSlug("Ragnaros"), "ragnaros");
});

test("realmSlug conserva los diacríticos del reino", () => {
  // Blizzard no los quita, y estos seis salen tal cual de la API en la
  // población acumulada. Un slug "normalizado" a ASCII es un 404 y un join
  // vacío, no un slug más limpio.
  assert.equal(realmSlug("Confrérie du Thorium"), "confrérie-du-thorium");
  assert.equal(realmSlug("Chants Éternels"), "chants-éternels");
  assert.equal(realmSlug("La Croisade Écarlate"), "la-croisade-écarlate");
  assert.equal(realmSlug("Festung der Stürme"), "festung-der-stürme");
  assert.equal(realmSlug("Marécage de Zangar"), "marécage-de-zangar");
});

test("realmSlug quita apóstrofos y paréntesis", () => {
  assert.equal(realmSlug("Pozzo dell'Eternità"), "pozzo-delleternità");
  assert.equal(realmSlug("Pozzo dell’Eternità"), "pozzo-delleternità");
  assert.equal(realmSlug("Aggra (Português)"), "aggra-português");
  assert.equal(realmSlug("Kil'jaeden"), "kiljaeden");
});

test("realmSlug es idempotente sobre un slug ya canónico", () => {
  // Se aplica indistintamente al nombre para mostrar y a lo que ya está
  // guardado, así que pasarlo dos veces no puede cambiar nada. Comprobado
  // además contra los 267 reinos de la población acumulada.
  for (const slug of ["twisting-nether", "confrérie-du-thorium", "aggra-português", "area-52"]) {
    assert.equal(realmSlug(slug), slug);
  }
});

// --- foldSlug ---

test("foldSlug quita los diacríticos para poder buscar", () => {
  assert.equal(foldSlug("artháslegend"), "arthaslegend");
  assert.equal(foldSlug("ártháslegend"), "arthaslegend");
  assert.equal(foldSlug("confrérie-du-thorium"), "confrerie-du-thorium");
});

test("foldSlug pliega las letras que NFD no descompone", () => {
  // Sin esto el plegado no sirve para media Europa: son 20.081 nombres de la
  // población acumulada los que salen del ASCII por aquí y no por un acento.
  assert.equal(foldSlug("smøkyy"), "smokyy");
  assert.equal(foldSlug("jahithßer"), "jahithsser");
  assert.equal(foldSlug("ðeadghøul"), "deadghoul");
  assert.equal(foldSlug("jpævl"), "jpaevl");
  assert.equal(foldSlug("þunder"), "thunder");
});

test("foldSlug no translitera el cirílico", () => {
  // No hay una forma "sin acentos" del ruso: hay transliteraciones, varias e
  // incompatibles. Quien busca a эльторо lo escribe en ruso.
  assert.equal(foldSlug("эльторо"), "эльторо");
});

test("foldSlug sí pliega los diacríticos del cirílico", () => {
  // Aquí no hay transliteración de por medio, hay un diacrítico: ё → е y й → и
  // es lo que hace NFD y lo que espera quien teclea en ruso.
  assert.equal(foldSlug("ёлка"), "елка");
  assert.equal(foldSlug("николай"), "николаи");
});

test("foldSlug es idempotente", () => {
  for (const name of ["artháslegend", "smøkyy", "jahithßer", "эльторо", "николай"]) {
    assert.equal(foldSlug(foldSlug(name)), foldSlug(name));
  }
});

test("foldSlug no es inyectivo, y eso es el punto", () => {
  // 1.626 grupos de la población acumulada colisionan así, con 3.734 personajes
  // reales y distintos dentro. Quien busque por esta clave tiene que estar
  // preparado para varias respuestas.
  assert.equal(foldSlug("artháslegend"), foldSlug("arthaslegend"));
  assert.notEqual(nameSlug("Artháslegend"), nameSlug("Arthaslegend"));
});

// --- resolveByFold ---

const REALMS = ["twisting-nether", "confrérie-du-thorium", "ravencrest"];

test("resolveByFold encuentra el slug conocido pese a los acentos", () => {
  assert.deepEqual(resolveByFold("confrerie-du-thorium", REALMS), ["confrérie-du-thorium"]);
  assert.deepEqual(resolveByFold("Confrérie du Thorium".toLowerCase(), REALMS), []);
});

test("resolveByFold devuelve todos los candidatos, no el primero", () => {
  const nombres = ["artháslegend", "arthaslegend", "árthaslegend"];
  assert.deepEqual(resolveByFold("arthaslegend", nombres), nombres);
});

test("resolveByFold conserva el orden de entrada", () => {
  // El criterio de desempate (rating, lo más reciente) es de quien llama; esta
  // función no se lo inventa.
  assert.deepEqual(resolveByFold("rat", ["råt", "rãt"]), ["råt", "rãt"]);
});

test("resolveByFold vacío es 'no lo conocemos', no 'no existe'", () => {
  assert.deepEqual(resolveByFold("nadie", REALMS), []);
});

// --- parseCharacterRef ---

test("parseCharacterRef canoniza reino y nombre", () => {
  assert.deepEqual(parseCharacterRef("Twisting-Nether/Anatorey"), {
    realmSlug: "twisting-nether",
    nameSlug: "anatorey",
  });
});

test("parseCharacterRef admite el reino escrito como nombre para mostrar", () => {
  assert.deepEqual(parseCharacterRef("Twisting Nether/Anatorey"), {
    realmSlug: "twisting-nether",
    nameSlug: "anatorey",
  });
});

test("parseCharacterRef conserva los acentos del nombre", () => {
  assert.equal(parseCharacterRef("sanguino/Ánatorey").nameSlug, "ánatorey");
});

test("parseCharacterRef rechaza lo que no tiene forma reino/nombre", () => {
  for (const malo of ["anatorey", "reino/", "/nombre", "a/b/c", "  /  "]) {
    assert.throws(() => parseCharacterRef(malo), /reino\/nombre/);
  }
});

test("formatCharacterRef escribe la forma canónica", () => {
  assert.equal(
    formatCharacterRef({ realmSlug: "sanguino", nameSlug: "ánatorey" }),
    "sanguino/ánatorey",
  );
});
