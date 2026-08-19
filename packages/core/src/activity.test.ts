import assert from "node:assert/strict";
import { test } from "node:test";
import { deriveActivity, isActiveWithin } from "./activity";

const DAY = 86_400_000;
const NOW = new Date("2026-08-19T12:00:00Z");

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function seen(days: number, matchesPlayed: number | null, counterSource = "leaderboard") {
  return { capturedAt: daysAgo(days), matchesPlayed, counterSource };
}

test("la actividad es la última subida del contador de partidas", () => {
  const activity = deriveActivity([seen(9, 100), seen(6, 104), seen(3, 104), seen(1, 112)]);

  assert.equal(activity?.evidence, "played-delta");
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(1).getTime());
  assert.equal(activity?.lastPlayed, 112);
});

test("volver a salir en el leaderboard sin jugar no es actividad", () => {
  // El caso real: el leaderboard se republica cada ~3h y quien está dentro del
  // top 5.000 sigue apareciendo aunque lleve una semana sin entrar al juego.
  const activity = deriveActivity([seen(9, 190), seen(5, 190), seen(2, 190), seen(0, 190)]);

  assert.equal(activity?.evidence, "first-seen");
  // Se fecha en la PRIMERA observación: es lo único demostrable, y es lo que
  // hace que quien deja de jugar acabe saliendo de la ventana.
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(9).getTime());
  assert.equal(activity?.lastSeenAt.getTime(), daysAgo(0).getTime());
});

test("una sola observación nunca puede ser evidencia de haber jugado", () => {
  const activity = deriveActivity([seen(2, 40)]);

  assert.equal(activity?.evidence, "first-seen");
  assert.equal(activity?.observations, 1);
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(2).getTime());
});

test("sin observaciones no hay actividad, que no es lo mismo que estar inactivo", () => {
  assert.equal(deriveActivity([]), null);
});

test("un hueco sin dato no rompe la comparación ni cuenta como no haber jugado", () => {
  // null es "no disponible" (regla 5): se compara contra el último valor
  // conocido, no se trata la observación intermedia como un contador a cero.
  const activity = deriveActivity([seen(8, 50), seen(5, null), seen(2, 58)]);

  assert.equal(activity?.evidence, "played-delta");
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(2).getTime());
});

test("si nunca viene el contador, la actividad no se inventa", () => {
  const activity = deriveActivity([seen(6, null), seen(3, null)]);

  assert.equal(activity?.evidence, "first-seen");
  assert.equal(activity?.lastPlayed, null);
});

test("un contador que baja reinicia la serie en vez de tragarse las subidas siguientes", () => {
  const activity = deriveActivity([seen(9, 300), seen(6, 12), seen(3, 20)]);

  // La bajada no es actividad, pero deja el listón en 12: si se conservara el
  // 300, la subida real de 12 a 20 pasaría desapercibida.
  assert.equal(activity?.evidence, "played-delta");
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(3).getTime());
  assert.equal(activity?.lastPlayed, 20);
});

test("el orden lo pone la función, no la query que la llama", () => {
  const activity = deriveActivity([seen(1, 112), seen(9, 100), seen(6, 104)]);

  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(1).getTime());
  assert.equal(activity?.firstSeenAt.getTime(), daysAgo(9).getTime());
});

test("la ventana se mide contra la fecha de actividad, no contra la de la última vez visto", () => {
  const activity = deriveActivity([seen(20, 190), seen(1, 190)]);
  assert.ok(activity);

  // Se le sigue viendo a diario, pero no ha jugado: fuera de 7 y de 14 días.
  assert.equal(isActiveWithin(activity, NOW, 7), false);
  assert.equal(isActiveWithin(activity, NOW, 14), false);
  // Dentro de la de 30, que es la de "season active" del ranking, no la del meta.
  assert.equal(isActiveWithin(activity, NOW, 30), true);
});

test("dos contadores de origen distinto no se restan entre sí", () => {
  // Medido en agosto de 2026: el perfil devuelve un número menor que el
  // leaderboard para el mismo personaje, bracket y rating (595 de 595 casos).
  // Compararlos daba una bajada y, detrás, una subida falsa al volver el
  // leaderboard — es decir, actividad de alguien que no jugó nada.
  const activity = deriveActivity([
    seen(6, 60, "leaderboard"),
    seen(5, 10, "profile"),
    seen(3, 60, "leaderboard"),
  ]);

  assert.equal(activity?.evidence, "first-seen");
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(6).getTime());
});

test("cada origen aporta su propia evidencia", () => {
  // El perfil es la única fuente de quien no sale en el leaderboard (§12), así
  // que su serie tiene que contar por sí misma, no descartarse.
  const activity = deriveActivity([
    seen(6, 60, "leaderboard"),
    seen(5, 10, "profile"),
    seen(3, 60, "leaderboard"),
    seen(1, 14, "profile"),
  ]);

  assert.equal(activity?.evidence, "played-delta");
  assert.equal(activity?.lastActiveAt.getTime(), daysAgo(1).getTime());
});
