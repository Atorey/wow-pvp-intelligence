import assert from "node:assert/strict";
import { test } from "node:test";
import {
  computeActivity,
  parseOptions,
  summarizeActivity,
  withPresence,
  type ComputedActivity,
  type ObservationRow,
} from "./refresh-activity";

const NOW = new Date("2026-08-19T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function seen(
  characterId: string,
  days: number,
  matchesPlayed: number | null,
  source = "leaderboard",
): ObservationRow {
  return { characterId, capturedAt: daysAgo(days), matchesPlayed, source };
}

// --- Argumentos ---

test("la temporada se puede fijar a mano y por defecto es la vigente", () => {
  assert.equal(parseOptions(["--season", "42"]).seasonId, 42);
  assert.equal(parseOptions([]).seasonId, null);
  assert.equal(parseOptions(["--dry-run"]).dryRun, true);
  assert.throws(() => parseOptions(["--season", "última"]), /id de temporada entero/);
  assert.throws(() => parseOptions(["--temporada", "42"]), /Opción desconocida/);
});

// --- Agrupado ---

test("cada personaje se deriva con su propia serie", () => {
  const rows = [seen("a", 6, 100), seen("b", 6, 40), seen("a", 2, 108), seen("b", 2, 40)];

  const activities = computeActivity("shuffle-mage-frost", rows);
  const byId = new Map(activities.map((a) => [a.characterId, a]));

  assert.equal(byId.get("a")?.evidence, "played-delta");
  assert.equal(byId.get("a")?.lastActiveAt.getTime(), daysAgo(2).getTime());
  // B sigue saliendo en el ladder con el mismo contador: visto, pero sin jugar.
  assert.equal(byId.get("b")?.evidence, "first-seen");
});

test("el bracket viaja con la actividad porque el contador es por spec", () => {
  // Un multiclasser tiene una serie por bracket: sumarlas daría subidas que en
  // esa spec no ocurrieron (§27, el spec activo cambia entre snapshots).
  const [activity] = computeActivity("shuffle-mage-fire", [seen("a", 3, 12)]);

  assert.equal(activity?.bracket, "shuffle-mage-fire");
  assert.equal(activity?.characterId, "a");
});

test("las observaciones desordenadas no cambian el resultado", () => {
  const activities = computeActivity("shuffle-mage-frost", [seen("a", 2, 108), seen("a", 6, 100)]);

  assert.equal(activities[0]?.lastActiveAt.getTime(), daysAgo(2).getTime());
  assert.equal(activities[0]?.observations, 2);
});

// --- Resumen ---

function computed(overrides: Partial<ComputedActivity>): ComputedActivity {
  return {
    characterId: "a",
    bracket: "shuffle-mage-frost",
    lastActiveAt: daysAgo(2),
    evidence: "played-delta",
    lastPlayed: 100,
    observations: 4,
    firstSeenAt: daysAgo(6),
    lastSeenAt: daysAgo(0),
    ...overrides,
  };
}

test("el resumen separa la evidencia del arranque", () => {
  const summary = summarizeActivity([
    computed({}),
    computed({ characterId: "b", evidence: "first-seen" }),
    computed({ characterId: "c", evidence: "first-seen" }),
  ]);

  assert.equal(summary.total, 3);
  assert.equal(summary.byDelta, 1);
  assert.equal(summary.byFirstSeen, 2);
});

test("se mide cuántos días de más daba por activo el proxy anterior", () => {
  // Visto hoy, jugando hace 6 días: el filtro por "última vez visto" le daba
  // 6 días de actividad que no tenía. Ese hueco es el sesgo que #16 quita.
  const summary = summarizeActivity([computed({ lastActiveAt: daysAgo(6), lastSeenAt: NOW })]);

  assert.equal(summary.medianProxyGapDays, 6);
});

test("sin población no se inventa un cero", () => {
  assert.equal(summarizeActivity([]).medianProxyGapDays, null);
  assert.equal(summarizeActivity([]).total, 0);
});

test("el contador de la búsqueda comparte listón con el del perfil", () => {
  // Los dos salen del mismo endpoint; separarlos daría una subida falsa cada
  // vez que un personaje muestreado se busca después a mano (o al revés).
  const activities = computeActivity("shuffle-mage-frost", [
    seen("a", 6, 60, "leaderboard"),
    seen("a", 5, 10, "profile"),
    seen("a", 2, 10, "search"),
  ]);

  assert.equal(activities[0]?.evidence, "first-seen");
});

// --- Presencia (#53) ---

test("el 'le hemos visto' sale de la presencia, no de la última fila de la serie", () => {
  // Desde #53 los snapshots solo guardan cambios: la serie termina el día en que
  // cambió algo, no el día en que le vimos. Sin presencia, el proxy se volvería
  // una tautología (lastSeenAt == lastActiveAt) y el sesgo mediría cero.
  const [activity] = withPresence(
    [computed({ lastActiveAt: daysAgo(6), lastSeenAt: daysAgo(6) })],
    new Map([["a", { characterId: "a", lastSeenAt: NOW }]]),
  );

  assert.equal(activity?.lastSeenAt.getTime(), NOW.getTime());
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(6).getTime());
  assert.equal(
    summarizeActivity(
      withPresence(
        [computed({ lastActiveAt: daysAgo(6), lastSeenAt: daysAgo(6) })],
        new Map([["a", { characterId: "a", lastSeenAt: NOW }]]),
      ),
    ).medianProxyGapDays,
    6,
  );
});

test("una observación de perfil más reciente que la lista no se pierde", () => {
  // La presencia solo la deja el leaderboard; un personaje muestreado o buscado
  // después sigue habiendo sido visto, y la fecha buena es la más reciente.
  const [activity] = withPresence(
    [computed({ lastSeenAt: NOW })],
    new Map([["a", { characterId: "a", lastSeenAt: daysAgo(3) }]]),
  );

  assert.equal(activity?.lastSeenAt.getTime(), NOW.getTime());
});

test("sin fila de presencia se deja lo derivado de la serie", () => {
  const [activity] = withPresence([computed({ lastSeenAt: daysAgo(1) })], new Map());

  assert.equal(activity?.lastSeenAt.getTime(), daysAgo(1).getTime());
});
