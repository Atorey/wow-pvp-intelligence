import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ACTIVITY_WINDOWS,
  MIN_SAMPLE_HIGH,
  MIN_SAMPLE_MEDIUM,
  aggregateGearItems,
  aggregateHeroTrees,
  aggregateTalentNodes,
  biggestGearDifferences,
  canShowComparison,
  confidenceFor,
  deriveActivity,
  foldSlug,
  hasComparableGear,
  hasComparablePvpTalents,
  hasComparableTalents,
  isActiveWithin,
  isDiscriminative,
  segmentFor,
  shuffleBracketId,
  requireSpecSlug,
  type PlayerBuild,
} from "@wowpvp/core";
import {
  buildSeedDataset,
  loadItemCatalog,
  summarize,
  CURRENT_SEASON,
  NAMED_CHARACTERS,
  PREVIOUS_SEASON,
  SEGMENT_PLAN,
  type SeedDataset,
  type SeedParticipation,
  type SeedTalent,
} from "./seed-dataset";

const NOW = new Date("2026-08-24T09:00:00.000Z");
const catalog = loadItemCatalog();

function build(seed = "test"): SeedDataset {
  return buildSeedDataset({ now: NOW, seed, catalog });
}

const dataset = build();

/** Los que están en la lista de un bracket y una temporada, con su rating final. */
function ladder(seasonId: number, spec: string): SeedParticipation[] {
  const bracket = shuffleBracketId(requireSpecSlug(spec));
  return dataset.participations.filter(
    (p) => p.seasonId === seasonId && p.bracket === bracket && p.origin === "ladder",
  );
}

function latestRating(participation: SeedParticipation): number {
  return participation.observations[participation.observations.length - 1]?.rating ?? 0;
}

function inSegment(participations: SeedParticipation[], segmentMin: number): SeedParticipation[] {
  return participations.filter((p) => segmentFor(latestRating(p)).min === segmentMin);
}

/**
 * Una lista vacía es "no lo pudimos leer", no "no lleva ninguno" (regla 5), que
 * es lo mismo que hace el job: sin filas en `character_snapshot_talents` para un
 * snapshot, el miembro entra con `null` y sale del denominador.
 */
function nullIfEmpty(selections: SeedTalent[] | undefined): SeedTalent[] | null {
  return selections && selections.length > 0 ? selections : null;
}

/** La misma forma con la que `refresh-aggregates` pasa la población a core. */
function asPlayerBuild(participation: SeedParticipation): PlayerBuild {
  const profile = participation.profile;
  return {
    characterId: `${participation.identity.realmSlug}|${participation.identity.nameSlug}`,
    rating: latestRating(participation),
    gearBySlot: new Map(profile?.gear.map((item) => [item.slot, item.itemId]) ?? []),
    talentLoadoutCode: profile?.talentLoadoutCode ?? null,
    // Igual que en el job: sin perfil no hay nodos, y `null` los saca del
    // denominador en vez de contarlos como no-adopción.
    talents: nullIfEmpty(profile?.talents.filter((t) => t.tree !== "pvp")),
    pvpTalents: nullIfEmpty(profile?.talents.filter((t) => t.tree === "pvp")),
    heroTalentTree: profile?.heroTalentTree ?? null,
    equippedItemLevel: profile?.equippedItemLevel ?? null,
    averageItemLevel: profile?.averageItemLevel ?? null,
  };
}

describe("dataset de desarrollo", () => {
  it("es reproducible: misma semilla, mismo dataset hasta el último item", () => {
    assert.deepEqual(build("misma"), build("misma"));
  });

  it("cambia entero al cambiar la semilla", () => {
    const otra = build("otra");
    assert.notDeepEqual(otra.identities, dataset.identities);
  });

  it("no repite identidad: (reino, nombre) es única", () => {
    const keys = dataset.identities.map((i) => `${i.realmSlug}|${i.nameSlug}`);
    assert.equal(new Set(keys).size, keys.length);
  });

  it("no repite blizzard_character_id, que tiene índice único por región", () => {
    const ids = dataset.identities.map((i) => i.blizzardCharacterId);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("no repite (personaje, bracket, captured_at), que es la clave de idempotencia", () => {
    const keys: string[] = [];
    for (const participation of dataset.participations) {
      const character = `${participation.identity.realmSlug}|${participation.identity.nameSlug}`;
      for (const observation of participation.observations) {
        keys.push(`${character}|${participation.bracket}|${observation.capturedAt.toISOString()}`);
      }
      if (participation.profile) {
        keys.push(
          `${character}|${participation.bracket}|${participation.profile.capturedAt.toISOString()}`,
        );
      }
    }
    assert.equal(new Set(keys).size, keys.length);
  });

  it("cumple el plan: cada escalón tiene la población y los perfiles declarados", () => {
    for (const { plan, population, profiles } of summarize(dataset).byPlan) {
      assert.equal(population, plan.population, `población de ${plan.spec} ${plan.segmentMin}`);
      assert.equal(profiles, plan.profiles, `perfiles de ${plan.spec} ${plan.segmentMin}`);
    }
  });
});

describe("los estados que el issue pide poder desarrollar", () => {
  it("hay al menos dos escalones con base de comparación `high`", () => {
    const high = SEGMENT_PLAN.filter((plan) => plan.profiles >= MIN_SAMPLE_HIGH);
    assert.ok(high.length >= 2, `solo ${high.length} escalón(es) llegan a n=${MIN_SAMPLE_HIGH}`);
  });

  it("hay un escalón con muestra insuficiente en todo", () => {
    const vacio = SEGMENT_PLAN.find(
      (plan) => !canShowComparison(plan.population) && plan.profiles === 0,
    );
    assert.ok(vacio, "ningún escalón reproduce el estado vacío del brief");
  });

  it("hay un escalón con población suficiente y gear insuficiente a la vez (#76)", () => {
    const plan = SEGMENT_PLAN.find(
      (candidate) =>
        canShowComparison(candidate.population) && !canShowComparison(candidate.profiles),
    );
    assert.ok(plan, "falta el caso de confianza de población distinta de la de comparación");
    assert.equal(confidenceFor(plan.population) === "insufficient", false);
    assert.equal(confidenceFor(plan.profiles), "insufficient");
  });

  it("conviven dos temporadas dentro de la ventana de actividad más ancha", () => {
    const seasons = new Set(dataset.participations.map((p) => p.seasonId));
    assert.deepEqual([...seasons].sort(), [PREVIOUS_SEASON, CURRENT_SEASON]);

    // Que estén las dos no basta: `refresh-aggregates` solo ve —y solo avisa
    // de— lo que cae dentro del corte con el que carga la población.
    const cutoff = new Date(NOW.getTime() - ACTIVITY_WINDOWS.fallback * 86_400_000);
    const previous = dataset.participations.filter((p) => p.seasonId === PREVIOUS_SEASON);
    assert.ok(
      previous.some((p) => p.observations.every((o) => o.capturedAt >= cutoff)),
      "la temporada anterior queda fuera de la ventana: el aviso de dos temporadas no saltaría",
    );
  });

  it("hay personajes con perfil completo: gear y talent_loadout_code", () => {
    const conTalentos = dataset.participations.filter(
      (p) => p.profile !== null && p.profile.talentLoadoutCode !== null,
    );
    assert.ok(conTalentos.length > 50);
    assert.ok(conTalentos.every((p) => (p.profile?.gear.length ?? 0) >= 16));
  });

  it("hay perfiles sin talent_loadout_code: null es «no disponible», no «no lleva»", () => {
    const sinCodigo = dataset.participations.filter(
      (p) => p.profile !== null && p.profile.talentLoadoutCode === null,
    );
    assert.ok(sinCodigo.length > 0);
  });
});

describe("la comparación que sostiene el Player Gap", () => {
  const frostMage = ladder(CURRENT_SEASON, "frost-mage");
  const propio = inSegment(frostMage, 1800).map(asPlayerBuild);
  const objetivo = inSegment(frostMage, 2000).map(asPlayerBuild);

  it("los dos escalones de la escalera llegan a confianza `high` en gear", () => {
    assert.ok(propio.filter(hasComparableGear).length >= MIN_SAMPLE_HIGH);
    assert.ok(objetivo.filter(hasComparableGear).length >= MIN_SAMPLE_HIGH);
  });

  it("las diferencias de gear entre escalones son discriminantes", () => {
    // Sin esto el dataset sería el peor fixture posible: lleno de población y
    // con la caja del Player Gap vacía, que parece que funciona y no enseña
    // nada. La inclinación por item level de `seed-dataset` existe para esto.
    const sujeto = propio.find(hasComparableGear);
    assert.ok(sujeto);

    const diferencias = biggestGearDifferences(sujeto, propio, objetivo);
    const discriminantes = diferencias.filter((d) => isDiscriminative(d.delta));
    assert.ok(
      discriminantes.length >= 3,
      `solo ${discriminantes.length} diferencia(s) pasan el umbral de ${100 * 0.1} puntos`,
    );
  });

  it("el adoption_rate del escalón objetivo no es monocultivo de un solo item", () => {
    // Un tilt sin freno dejaría un item al 100% en cada slot: el porcentaje
    // sería real y no diría nada.
    const variables = aggregateGearItems(objetivo);
    const dominantes = variables.filter((v) => v.adoption.value > 0.98);
    assert.equal(dominantes.length, 0, "hay slots con un único item posible");
  });

  it("la base de nodos alcanza para comparar, y es menor que la de gear", () => {
    // Menor a propósito: el `talentCoverage` del plan deja perfiles con gear y
    // sin talentos, que es el estado en el que estará producción los primeros
    // días tras el ADR 0026. Un seed donde las dos bases coincidieran dejaría
    // sin ejercitar justo el motivo por el que son dos columnas.
    for (const escalon of [propio, objetivo]) {
      const nodos = escalon.filter(hasComparableTalents).length;
      assert.ok(canShowComparison(nodos), `solo ${nodos} perfiles con nodos`);
      assert.ok(nodos < escalon.filter(hasComparableGear).length);
    }
  });

  it("hay nodos que discriminan entre un escalón y el siguiente", () => {
    // La razón de ser del ADR 0026, en el dataset local: si esta lista saliera
    // vacía, el seed tendría talentos y ninguna comparación que enseñar, que es
    // exactamente lo que pasa con el código de loadout completo.
    const propias = new Map(aggregateTalentNodes(propio).map((v) => [v.key, v.adoption.value]));
    const discriminantes = aggregateTalentNodes(objetivo).filter((v) =>
      isDiscriminative(v.adoption.value - (propias.get(v.key) ?? 0)),
    );

    assert.ok(
      discriminantes.length >= 3,
      `solo ${discriminantes.length} nodo(s) se mueven 10 puntos entre escalones`,
    );
  });

  it("el árbol de héroe está escorado, como en producción", () => {
    // 98/2 en Frost y 71/29 en Fury sobre datos reales: un 50/50 sembrado daría
    // una variable que no describe ninguna elección.
    const trees = aggregateHeroTrees(objetivo);
    assert.equal(trees.length, 2);
    assert.ok(Math.max(...trees.map((t) => t.adoption.value)) > 0.6);
  });

  it("nodos y talentos PvP no comparten denominador", () => {
    // El seed tira ~12% de los talentos PvP a propósito: si los dos
    // denominadores fueran iguales, nadie notaría que el código los fundió.
    const conNodos = objetivo.filter(hasComparableTalents).length;
    const conPvp = objetivo.filter(hasComparablePvpTalents).length;
    assert.ok(conPvp < conNodos, "el seed no distingue las dos ausencias");
    assert.ok(conPvp >= MIN_SAMPLE_MEDIUM);
  });

  it("la mediana de item level sube con el escalón", () => {
    const mediana = (builds: PlayerBuild[]): number => {
      const levels = builds
        .map((b) => b.equippedItemLevel)
        .filter((level): level is number => level !== null)
        .sort((a, b) => a - b);
      return levels[Math.floor(levels.length / 2)] ?? 0;
    };
    assert.ok(mediana(objetivo) > mediana(propio));
  });
});

describe("actividad", () => {
  const frostMage = ladder(CURRENT_SEASON, "frost-mage");

  it("la mayoría entra por subida vista del contador de partidas", () => {
    const evidencias = frostMage.map((participation) =>
      deriveActivity(
        participation.observations.map((o) => ({
          capturedAt: o.capturedAt,
          matchesPlayed: o.matchesPlayed,
          counterSource: "leaderboard",
        })),
      ),
    );

    const delta = evidencias.filter((a) => a?.evidence === "played-delta").length;
    const firstSeen = evidencias.filter((a) => a?.evidence === "first-seen").length;
    assert.ok(delta > firstSeen, "sin `played-delta` no se puede desarrollar el reparto de §27");
    assert.ok(firstSeen > 0, "sin `first-seen` falta el caso mayoritario de producción");
  });

  it("todos los de la temporada vigente caen dentro de la ventana de 7 días", () => {
    for (const participation of frostMage) {
      const activity = deriveActivity(
        participation.observations.map((o) => ({
          capturedAt: o.capturedAt,
          matchesPlayed: o.matchesPlayed,
          counterSource: "leaderboard",
        })),
      );
      assert.ok(activity);
      assert.ok(
        isActiveWithin(activity, NOW, ACTIVITY_WINDOWS.default),
        "un personaje sembrado fuera de la ventana no llegaría al agregado",
      );
    }
  });

  it("el contador del perfil es menor que el del leaderboard (ADR 0008)", () => {
    const conAmbos = frostMage.filter((p) => p.profile !== null && p.observations.length > 0);
    assert.ok(conAmbos.length > 0);
    for (const participation of conAmbos) {
      const ultima = participation.observations[participation.observations.length - 1];
      assert.ok((participation.profile?.matchesPlayed ?? 0) < (ultima?.matchesPlayed ?? 0));
    }
  });

  it("la presencia cuenta más publicaciones que snapshots (ADR 0009)", () => {
    for (const participation of dataset.participations) {
      if (!participation.presence) continue;
      assert.ok(participation.presence.publications > participation.observations.length);
    }
  });

  it("la temporada terminada está congelada: un solo snapshot por personaje", () => {
    for (const participation of dataset.participations) {
      if (participation.seasonId !== PREVIOUS_SEASON) continue;
      assert.equal(participation.observations.length, 1);
    }
  });
});

describe("los personajes con nombre fijo", () => {
  it("están todos en el dataset, con su identidad exacta", () => {
    for (const character of NAMED_CHARACTERS) {
      const found = dataset.identities.find(
        (identity) =>
          identity.realmSlug === character.realmSlug &&
          identity.nameSlug === character.nameDisplay.toLowerCase(),
      );
      assert.ok(found, `falta ${character.realmSlug}/${character.nameDisplay}`);
    }
  });

  it("hay un grupo que pliega al mismo nombre sin ser la misma persona (ADR 0017)", () => {
    const porPlegado = new Map<string, Set<string>>();
    for (const identity of dataset.identities) {
      const key = `${identity.realmSlug}|${foldSlug(identity.nameSlug)}`;
      porPlegado.set(key, (porPlegado.get(key) ?? new Set()).add(identity.nameSlug));
    }
    const colisiones = [...porPlegado.values()].filter((slugs) => slugs.size > 1);
    assert.ok(colisiones.length >= 1, "sin colisión de plegado no se puede probar la búsqueda");
    assert.ok(colisiones.some((slugs) => slugs.size >= 3));
  });

  it("hay un reino con acento en el propio slug", () => {
    assert.ok(dataset.identities.some((identity) => /[^\x20-\x7e]/.test(identity.realmSlug)));
  });

  it("los que vienen de búsqueda no dejan presencia y no están en la lista", () => {
    const busqueda = dataset.participations.filter((p) => p.origin === "search");
    assert.ok(busqueda.length >= 3);
    for (const participation of busqueda) {
      assert.equal(participation.presence, null);
      assert.equal(participation.observations.length, 0);
      assert.notEqual(participation.profile, null);
    }
  });

  it("dos de los de búsqueda caen en un escalón poblado, para que se cuenten como excluidos", () => {
    const frostMage = ladder(CURRENT_SEASON, "frost-mage");
    const busqueda = dataset.participations.filter((p) => p.origin === "search");

    const enPoblado = busqueda.filter((participation) => {
      const named = NAMED_CHARACTERS.find(
        (c) => c.nameDisplay.toLowerCase() === participation.identity.nameSlug,
      );
      if (!named) return false;
      return inSegment(frostMage, segmentFor(named.rating).min).length > 0;
    });

    assert.ok(
      enPoblado.length >= 2,
      "`excluded_search` solo se guarda en escalones que tienen fila propia",
    );
  });

  it("hay un personaje con histórico en las dos temporadas", () => {
    const porIdentidad = new Map<string, Set<number>>();
    for (const participation of dataset.participations) {
      const key = `${participation.identity.realmSlug}|${participation.identity.nameSlug}`;
      porIdentidad.set(key, (porIdentidad.get(key) ?? new Set()).add(participation.seasonId));
    }
    const cruzan = [...porIdentidad.values()].filter((seasons) => seasons.size > 1);
    assert.ok(cruzan.length >= 10, "sin histórico que cruce temporadas no hay #28 que desarrollar");
  });
});

describe("catálogo de items", () => {
  it("cubre las specs del plan y todas sus entradas son del catálogo canónico", () => {
    for (const plan of SEGMENT_PLAN) {
      if (plan.profiles === 0) continue;
      assert.ok(catalog.has(plan.spec), `el catálogo no tiene items de ${plan.spec}`);
    }
  });

  it("todo item sembrado sale del catálogo, con su nombre y su nivel", () => {
    for (const participation of dataset.participations) {
      const slots = catalog.get(`${participation.spec.specSlug}-${participation.spec.classSlug}`);
      for (const item of participation.profile?.gear ?? []) {
        const candidatos = slots?.get(item.slot) ?? [];
        assert.ok(
          candidatos.some(
            (candidate) => candidate.itemId === item.itemId && candidate.name === item.itemName,
          ),
          `${item.itemName} (${item.itemId}) no está en el catálogo para ${item.slot}`,
        );
      }
    }
  });

  it("los tiers por debajo de 1800 quedan a null: no se observaron (regla 5)", () => {
    for (const participation of dataset.participations) {
      for (const observation of participation.observations) {
        if (observation.rating < 1800) assert.equal(observation.pvpTierId, null);
        else assert.notEqual(observation.pvpTierId, null);
      }
    }
  });

  it("el rango de la muestra se respeta: MIN_SAMPLE_MEDIUM sigue siendo el umbral", () => {
    // Guarda contra un cambio silencioso de umbral que dejara el plan sin
    // sentido: si MIN_SAMPLE_MEDIUM subiera, el escalón de 48 dejaría de ser
    // «población suficiente» y este dataset ya no cubriría el caso de #76.
    assert.equal(MIN_SAMPLE_MEDIUM, 30);
  });
});
