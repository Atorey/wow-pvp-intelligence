import assert from "node:assert/strict";
import { test } from "node:test";
import { activeSpecOf, isProfileFresh, shuffleBracketsFromSummary } from "./character-lookup";

const HOST = "https://eu.api.blizzard.com";
const BASE = `${HOST}/profile/wow/character/ragnaros/alice`;

function summary(brackets: string[]): { brackets: { href: string }[] } {
  return {
    brackets: brackets.map((b) => ({ href: `${BASE}/pvp-bracket/${b}?namespace=profile-eu` })),
  };
}

// --- shuffleBracketsFromSummary ---

test("shuffleBracketsFromSummary resuelve los brackets de shuffle contra el catálogo", () => {
  const brackets = shuffleBracketsFromSummary(summary(["shuffle-mage-frost"]));

  assert.equal(brackets.length, 1);
  assert.equal(brackets[0]?.bracket, "shuffle-mage-frost");
  assert.deepEqual(brackets[0]?.spec.specSlug, "frost");
  assert.deepEqual(brackets[0]?.spec.classSlug, "mage");
  assert.equal(
    brackets[0]?.path,
    "/profile/wow/character/ragnaros/alice/pvp-bracket/shuffle-mage-frost",
  );
});

test("shuffleBracketsFromSummary descarta lo que el modelo no sabe representar", () => {
  // 2v2/3v3/RBG no nombran ninguna spec, y class_slug/spec_slug se deducen del
  // bracket: entran con #34, no a medias. "shuffle-overall" es el agregado, no
  // una spec.
  const brackets = shuffleBracketsFromSummary(
    summary(["2v2", "3v3", "rbg", "shuffle-overall", "shuffle-warrior-arms"]),
  );

  assert.deepEqual(
    brackets.map((b) => b.bracket),
    ["shuffle-warrior-arms"],
  );
});

test("shuffleBracketsFromSummary ignora enlaces rotos sin tumbar el resto", () => {
  const brackets = shuffleBracketsFromSummary({
    brackets: [
      { href: "no-es-una-url" },
      {},
      { href: `${BASE}/pvp-bracket/shuffle-priest-shadow` },
    ],
  });

  assert.deepEqual(
    brackets.map((b) => b.bracket),
    ["shuffle-priest-shadow"],
  );
});

test("shuffleBracketsFromSummary no repite un bracket que venga dos veces", () => {
  const brackets = shuffleBracketsFromSummary(
    summary(["shuffle-mage-frost", "shuffle-mage-frost", "shuffle-mage-fire"]),
  );

  assert.deepEqual(
    brackets.map((b) => b.bracket),
    ["shuffle-mage-fire", "shuffle-mage-frost"],
  );
});

// --- activeSpecOf ---

test("activeSpecOf resuelve la spec equipada contra el catálogo", () => {
  const spec = activeSpecOf({
    character_class: { name: "Death Knight" },
    active_spec: { name: "Frost" },
  });

  assert.equal(spec?.classSlug, "death-knight");
  assert.equal(spec?.specSlug, "frost");
});

test("activeSpecOf resuelve nombres de spec compuestos", () => {
  const spec = activeSpecOf({
    character_class: { name: "Hunter" },
    active_spec: { name: "Beast Mastery" },
  });

  assert.equal(spec?.specSlug, "beast-mastery");
});

test("activeSpecOf devuelve null si la API no dice qué lleva puesto", () => {
  // Sin spec activa no se sabe de qué bracket es el gear: no se le cuelga a
  // ninguno, en vez de adjudicárselo al primero.
  assert.equal(activeSpecOf({ character_class: { name: "Mage" } }), null);
  assert.equal(activeSpecOf({}), null);
  assert.equal(
    activeSpecOf({ character_class: { name: "Bardo" }, active_spec: { name: "Jazz" } }),
    null,
  );
});

// --- isProfileFresh ---

const NOW = new Date("2026-08-19T12:00:00Z");
const minutesAgo = (n: number): Date => new Date(NOW.getTime() - n * 60_000);

test("isProfileFresh considera fresco lo capturado dentro del TTL", () => {
  assert.equal(isProfileFresh(minutesAgo(5), NOW, 30), true);
  assert.equal(isProfileFresh(minutesAgo(29), NOW, 30), true);
});

test("isProfileFresh caduca justo al cumplirse el TTL", () => {
  assert.equal(isProfileFresh(minutesAgo(30), NOW, 30), false);
  assert.equal(isProfileFresh(minutesAgo(31), NOW, 30), false);
});

test("isProfileFresh no considera fresco a quien nunca se le bajó el perfil", () => {
  // Un personaje visto solo en leaderboard tiene rating, pero ni gear ni
  // talentos: la búsqueda tiene que llamar igual.
  assert.equal(isProfileFresh(null, NOW, 30), false);
});

test("isProfileFresh trata una captura futura como caducada", () => {
  // Reloj mal puesto (nuestro o del servidor): si se tomara por fresca, ese
  // personaje quedaría congelado hasta que el futuro alcance a su timestamp.
  assert.equal(isProfileFresh(new Date(NOW.getTime() + 60_000), NOW, 30), false);
});

test("isProfileFresh con TTL 0 nunca cachea", () => {
  assert.equal(isProfileFresh(minutesAgo(0), NOW, 0), false);
});
