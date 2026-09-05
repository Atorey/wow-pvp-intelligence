import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildMembers,
  computeSegments,
  parseOptions,
  selectByWindow,
  type ActiveRow,
  type Member,
  type ProfileRow,
} from "./refresh-aggregates";

const NOW = new Date("2026-08-19T12:00:00Z");
const DAY = 86_400_000;

function daysAgo(days: number): Date {
  return new Date(NOW.getTime() - days * DAY);
}

function active(overrides: Partial<ActiveRow> & { characterId: string }): ActiveRow {
  return {
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    rating: 1900,
    capturedAt: daysAgo(1),
    lastActiveAt: daysAgo(1),
    activityEvidence: "played-delta",
    ...overrides,
  };
}

function member(overrides: Partial<Member> & { characterId: string }): Member {
  return {
    bracket: "shuffle-mage-frost",
    classSlug: "mage",
    specSlug: "frost",
    rating: 1900,
    capturedAt: daysAgo(1),
    lastActiveAt: daysAgo(1),
    activityEvidence: "played-delta",
    profileCapturedAt: null,
    gearBySlot: new Map(),
    gems: [],
    enchantments: [],
    talentLoadoutCode: null,
    talents: null,
    heroTalentTree: null,
    pvpTalents: null,
    equippedItemLevel: null,
    averageItemLevel: null,
    ...overrides,
  };
}

// --- Argumentos ---

test("solo se aceptan las ventanas de actividad de §27", () => {
  assert.equal(parseOptions(["--window", "7"]).window, 7);
  assert.equal(parseOptions(["--window", "30"]).window, 30);
  // 10 días no es una ventana del plan: inventarla aquí la dejaría fuera de la
  // única definición compartida con la web (packages/core).
  assert.throws(() => parseOptions(["--window", "10"]), /ventanas de §27/);
  assert.throws(() => parseOptions(["--ventana", "7"]), /Opción desconocida/);
});

test("sin --window la ventana la elige cada segmento", () => {
  assert.equal(parseOptions([]).window, null);
  assert.equal(parseOptions(["--dry-run"]).dryRun, true);
});

// --- Composición de la población ---

test("el rating es del snapshot más reciente y el gear del último perfil", () => {
  const profiles: ProfileRow[] = [
    {
      characterId: "a",
      bracket: "shuffle-mage-frost",
      capturedAt: daysAgo(5),
      equippedItemLevel: 630,
      averageItemLevel: 634,
      talentLoadoutCode: "CODE",
      talents: null,
      pvpTalents: null,
      heroTalentTree: null,
      gearBySlot: new Map([["HEAD", 1]]),
      gems: [],
      enchantments: [],
    },
  ];

  const [built] = buildMembers([active({ characterId: "a", rating: 2050 })], profiles);

  // El rating manda para segmentar (es de ayer); el gear es de hace 5 días
  // porque el perfil no se baja en cada publicación del leaderboard.
  assert.equal(built?.rating, 2050);
  assert.equal(built?.equippedItemLevel, 630);
  assert.equal(built?.profileCapturedAt?.getTime(), daysAgo(5).getTime());
});

test("sin perfil, el personaje cuenta en el segmento pero no en los denominadores", () => {
  const [built] = buildMembers([active({ characterId: "b" })], []);

  assert.equal(built?.gearBySlot.size, 0);
  assert.equal(built?.talentLoadoutCode, null);
  assert.equal(built?.equippedItemLevel, null);
  // Y lo mismo con los nodos: `null`, no `[]`. Un personaje del que solo
  // tenemos la fila de leaderboard no es alguien que no lleva talentos, y esa
  // diferencia es la que lo saca del denominador en vez de hundir la adopción.
  assert.equal(built?.talents, null);
  assert.equal(built?.pvpTalents, null);
  assert.equal(built?.heroTalentTree, null);
});

test("un perfil anterior al ADR 0026 tiene código pero no nodos", () => {
  // Los ~13.000 snapshots guardados antes de la migración 0012. Cuentan en
  // talent_sample y no en talent_node_sample, que es justo por qué son dos
  // denominadores y no uno.
  const profiles: ProfileRow[] = [
    {
      characterId: "a",
      bracket: "shuffle-mage-frost",
      capturedAt: daysAgo(1),
      equippedItemLevel: 630,
      averageItemLevel: 632,
      talentLoadoutCode: "CODE",
      talents: null,
      pvpTalents: null,
      heroTalentTree: null,
      gearBySlot: new Map([["HEAD", 1]]),
      gems: [],
      enchantments: [],
    },
  ];

  const [built] = buildMembers([active({ characterId: "a" })], profiles);
  assert.equal(built?.talentLoadoutCode, "CODE");
  assert.equal(built?.talents, null);
});

test("el perfil se pega al mismo personaje en el mismo bracket, no en otro", () => {
  const profiles: ProfileRow[] = [
    {
      characterId: "a",
      bracket: "shuffle-mage-fire",
      capturedAt: daysAgo(2),
      equippedItemLevel: 640,
      averageItemLevel: 640,
      talentLoadoutCode: "FIRE",
      talents: null,
      pvpTalents: null,
      heroTalentTree: null,
      gearBySlot: new Map([["HEAD", 9]]),
      gems: [],
      enchantments: [],
    },
  ];

  // Un multiclasser tiene builds distintas por spec: el gear de su Fire Mage no
  // describe a su Frost Mage.
  const [built] = buildMembers([active({ characterId: "a" })], profiles);
  assert.equal(built?.talentLoadoutCode, null);
});

// --- Ventana de actividad ---

test("se usa la ventana de 7 días cuando alcanza muestra", () => {
  const members = Array.from({ length: 30 }, (_, i) =>
    member({ characterId: `c${i}`, lastActiveAt: daysAgo(3) }),
  );

  const selected = selectByWindow(members, NOW, null);
  assert.equal(selected.window, 7);
  assert.equal(selected.members.length, 30);
});

test("se cae a 14 días solo si 7 no llega a n=30", () => {
  const members = [
    ...Array.from({ length: 20 }, (_, i) =>
      member({ characterId: `fresh${i}`, lastActiveAt: daysAgo(2) }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      member({ characterId: `stale${i}`, lastActiveAt: daysAgo(10) }),
    ),
  ];

  const selected = selectByWindow(members, NOW, null);
  // 20 a 7 días es "insufficient"; con 14 son 40 y la comparación se sostiene.
  assert.equal(selected.window, 14);
  assert.equal(selected.members.length, 40);
});

test("quien no ha jugado queda fuera de la ventana aunque se le siga viendo", () => {
  const members = [
    member({ characterId: "activo", lastActiveAt: daysAgo(1) }),
    // Sale en el leaderboard de ayer, pero su contador de partidas no se mueve
    // desde hace 40 días: eso es exactamente lo que §27 no quiere en el agregado.
    member({ characterId: "inactivo", capturedAt: daysAgo(1), lastActiveAt: daysAgo(40) }),
  ];

  assert.equal(selectByWindow(members, NOW, 7).members.length, 1);
  // Ni siquiera con la ventana de "season active": 40 días es 40 días.
  assert.equal(selectByWindow(members, NOW, 30).members.length, 1);
});

test("una ventana forzada no se reajusta por muestra", () => {
  const members = [member({ characterId: "solo", lastActiveAt: daysAgo(2) })];
  const selected = selectByWindow(members, NOW, 7);

  // n=1 es insuficiente, pero el operador pidió 7 días: la fila saldrá con su
  // confianza "insufficient", no con una ventana distinta a la declarada.
  assert.equal(selected.window, 7);
  assert.equal(selected.members.length, 1);
});

// --- Segmentación ---

test("cada segmento se calcula con su propia ventana", () => {
  const members = [
    // 1800-2000: población fresca de sobra.
    ...Array.from({ length: 30 }, (_, i) =>
      member({ characterId: `low${i}`, rating: 1900, lastActiveAt: daysAgo(2) }),
    ),
    // 2000-2200: solo llega a muestra estirando a 14 días.
    ...Array.from({ length: 20 }, (_, i) =>
      member({ characterId: `midA${i}`, rating: 2100, lastActiveAt: daysAgo(2) }),
    ),
    ...Array.from({ length: 20 }, (_, i) =>
      member({ characterId: `midB${i}`, rating: 2100, lastActiveAt: daysAgo(9) }),
    ),
  ];

  const segments = computeSegments(members, [], NOW, null);
  const byId = new Map(segments.map((s) => [s.segmentId, s]));

  assert.equal(byId.get("1800-2000")?.window, 7);
  assert.equal(byId.get("2000-2200")?.window, 14);
  assert.equal(byId.get("2000-2200")?.summary.sampleSize, 40);
});

test("un segmento sin nadie dentro de la ventana no se escribe", () => {
  const members = [member({ characterId: "viejo", rating: 2500, lastActiveAt: daysAgo(20) })];

  // La fila diría n=0 sin distinguir "no hay nadie en ese tramo" de "no lo
  // miramos", y esa ambigüedad es justo lo que el proyecto evita en la bitácora.
  assert.deepEqual(computeSegments(members, [], NOW, null), []);
});

test("el tramo abierto de arriba no finge un máximo", () => {
  const members = [member({ characterId: "top", rating: 3100 })];
  const [segment] = computeSegments(members, [], NOW, null);

  assert.equal(segment?.segmentMin, 3000);
  assert.equal(segment?.segmentMax, null);
});

test("los personajes que solo vienen de búsqueda se cuentan aparte, no dentro", () => {
  const members = [member({ characterId: "ladder", rating: 1900 })];
  const searchOnly = [
    { bracket: "shuffle-mage-frost", rating: 1850 },
    { bracket: "shuffle-mage-frost", rating: 1950 },
    { bracket: "shuffle-mage-frost", rating: 2100 },
  ];

  const segments = computeSegments(members, searchOnly, NOW, null);
  const [segment] = segments;

  assert.equal(segment?.segmentId, "1800-2000");
  // El sesgo de selección de §12 no entra en el n que sostiene la confianza...
  assert.equal(segment?.summary.sampleSize, 1);
  // ...pero queda contado para poder revisar la decisión con dato delante.
  assert.equal(segment?.excludedSearch, 2);
  // El de 2100 no crea un segmento: sin población agregable no hay fila.
  assert.equal(segments.length, 1);
});

test("el rango temporal de los perfiles queda registrado", () => {
  const members = [
    member({ characterId: "a", profileCapturedAt: daysAgo(6), gearBySlot: new Map([["HEAD", 1]]) }),
    member({ characterId: "b", profileCapturedAt: daysAgo(2), gearBySlot: new Map([["HEAD", 1]]) }),
    member({ characterId: "c" }),
  ];

  const [segment] = computeSegments(members, [], NOW, null);

  // El rating es de ayer pero el gear más viejo es de hace 6 días: la distancia
  // entre las dos fuentes tiene que poder leerse en la fila, no suponerse.
  assert.equal(segment?.profileFrom?.getTime(), daysAgo(6).getTime());
  assert.equal(segment?.profileTo?.getTime(), daysAgo(2).getTime());
  assert.equal(segment?.summary.gearSample, 2);
  assert.equal(segment?.summary.sampleSize, 3);
});

test("la fila declara cuánta de su población es evidencia y cuánta es arranque", () => {
  const members = [
    member({ characterId: "a", activityEvidence: "played-delta" }),
    member({ characterId: "b", activityEvidence: "first-seen" }),
    member({ characterId: "c", activityEvidence: "first-seen" }),
  ];

  const [segment] = computeSegments(members, [], NOW, null);

  // n=3 hecho de 1 subida vista y 2 arranques no promete lo mismo que n=3 de
  // tres subidas vistas, y con el histórico corto de hoy el segundo caso es el
  // raro: sin este reparto, la fila no permitiría distinguirlos (§27, #16).
  assert.equal(segment?.summary.sampleSize, 3);
  assert.equal(segment?.activeByDelta, 1);
  assert.equal(segment?.activeByFirstSeen, 2);
});
