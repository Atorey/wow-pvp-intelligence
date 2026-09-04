import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSpec } from "@wowpvp/core";
import { findTalentLoadout, mapEquipment, mapPvpTalents, specNameToSlug } from "./profile-mapping";

const FROST_MAGE = requireSpec("mage", "frost");

test("un item completo se mapea con sus gemas, encantamientos y bonus", () => {
  const rows = mapEquipment({
    equipped_items: [
      {
        slot: { type: "HEAD" },
        item: { id: 212000 },
        name: "Yelmo",
        level: { value: 639 },
        quality: { type: "EPIC" },
        enchantments: [{ enchantment_id: 7346 }],
        sockets: [{ item: { id: 213743 } }, { item: { id: 213746 } }],
        bonus_list: [1, 2, 3],
      },
    ],
  });

  assert.deepEqual(rows, [
    {
      slot: "HEAD",
      itemId: 212000,
      itemName: "Yelmo",
      itemLevel: 639,
      quality: "EPIC",
      enchantmentIds: [7346],
      gemItemIds: [213743, 213746],
      bonusList: [1, 2, 3],
    },
  ]);
});

test("un item sin gemas ni encantamientos da arrays vacíos, nunca null", () => {
  // Las columnas son `not null default '{}'`, y además "no lleva gema" es un
  // hecho observado, no un dato ausente.
  const rows = mapEquipment({
    equipped_items: [{ slot: { type: "WRIST" }, item: { id: 999 } }],
  });

  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0]?.enchantmentIds, []);
  assert.deepEqual(rows[0]?.gemItemIds, []);
  assert.deepEqual(rows[0]?.bonusList, []);
  // Lo que sí falta de verdad va a null.
  assert.equal(rows[0]?.itemName, null);
  assert.equal(rows[0]?.itemLevel, null);
});

test("un item sin slot o sin id se descarta (columnas not null)", () => {
  const rows = mapEquipment({
    equipped_items: [
      { item: { id: 1 } },
      { slot: { type: "HEAD" } },
      { slot: { type: "NECK" }, item: { id: 2 } },
    ],
  });

  assert.deepEqual(
    rows.map((r) => r.slot),
    ["NECK"],
  );
});

test("un slot repetido no se duplica (la PK es snapshot_id + slot)", () => {
  const rows = mapEquipment({
    equipped_items: [
      { slot: { type: "TRINKET_1" }, item: { id: 1 } },
      { slot: { type: "TRINKET_1" }, item: { id: 2 } },
    ],
  });

  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.itemId, 1);
});

test("un equipment vacío no revienta: devuelve lista vacía", () => {
  assert.deepEqual(mapEquipment({}), []);
});

test("se coge el loadout de la spec del bracket, no el de la spec activa", () => {
  // Un Frost Mage del leaderboard que hoy juega Fire: el loadout activo es de
  // Fire, y meterlo en el análisis de Frost contaminaría el segmento.
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Fire" },
          loadouts: [{ is_active: true, talent_loadout_code: "CODIGO-FIRE" }],
        },
        {
          specialization: { name: "Frost" },
          loadouts: [{ is_active: false, talent_loadout_code: "CODIGO-FROST" }],
        },
      ],
    },
    FROST_MAGE,
  );

  assert.equal(result.code, "CODIGO-FROST");
  assert.equal(result.outcome, "ok");
});

test("dentro de la spec correcta se prefiere el loadout activo", () => {
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Frost" },
          loadouts: [
            { is_active: false, talent_loadout_code: "GUARDADO" },
            { is_active: true, talent_loadout_code: "ACTIVO" },
          ],
        },
      ],
    },
    FROST_MAGE,
  );

  assert.equal(result.code, "ACTIVO");
});

test("sin loadout activo se usa el primero que traiga código", () => {
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Frost" },
          loadouts: [{ talent_loadout_code: "UNICO" }],
        },
      ],
    },
    FROST_MAGE,
  );

  assert.equal(result.code, "UNICO");
  assert.equal(result.outcome, "ok");
});

test("los motivos de null se distinguen entre sí", () => {
  // El riesgo del parche 11.2 es 'no-code': la API responde y aun así no trae
  // el código. Confundirlo con 'spec-not-listed' borraría el dato que este
  // muestreo viene a medir.
  const outcomes = (response: Parameters<typeof findTalentLoadout>[0]) => {
    const result = findTalentLoadout(response, FROST_MAGE);
    // Sin loadout elegido no hay nodos que sacar de ninguna parte: la lista vacía
    // acompaña siempre a un código nulo, nunca lo contradice.
    assert.deepEqual(result.talents, []);
    assert.equal(result.heroTree, null);
    assert.equal(result.code, null);
    return result.outcome;
  };

  assert.equal(
    outcomes({ specializations: [{ specialization: { name: "Fire" } }] }),
    "spec-not-listed",
  );
  assert.equal(
    outcomes({ specializations: [{ specialization: { name: "Frost" }, loadouts: [] }] }),
    "no-loadout",
  );
  assert.equal(
    outcomes({
      specializations: [{ specialization: { name: "Frost" }, loadouts: [{ is_active: true }] }],
    }),
    "no-code",
  );
  assert.equal(outcomes({}), "spec-not-listed");
});

test("un código vacío cuenta como ausente, no como código", () => {
  assert.equal(
    findTalentLoadout(
      {
        specializations: [
          { specialization: { name: "Frost" }, loadouts: [{ talent_loadout_code: "" }] },
        ],
      },
      FROST_MAGE,
    ).outcome,
    "no-code",
  );
});

test("los nombres de spec de varias palabras casan con su slug", () => {
  assert.equal(specNameToSlug("Beast Mastery"), "beast-mastery");
  assert.equal(specNameToSlug("  Frost "), "frost");
  assert.equal(
    findTalentLoadout(
      {
        specializations: [
          {
            specialization: { name: "Beast Mastery" },
            loadouts: [{ is_active: true, talent_loadout_code: "BM" }],
          },
        ],
      },
      requireSpec("hunter", "beast-mastery"),
    ).code,
    "BM",
  );
});

// --- Nodos de talento (ADR 0026) ---

/** Un loadout completo de Frost, con nodos, árbol de héroe y talentos PvP. */
const FROST_WITH_NODES = {
  specializations: [
    {
      specialization: { name: "Frost" },
      pvp_talent_slots: [
        { selected: { talent: { id: 3517, name: "Ice Wall" } } },
        { selected: { talent: { id: 828, name: "Precognition" } } },
      ],
      loadouts: [
        {
          is_active: true,
          talent_loadout_code: "CODIGO-FROST",
          selected_class_talents: [
            { id: 62191, rank: 1, tooltip: { talent: { name: "Shimmer" } } },
            { id: 62192, rank: 2, tooltip: { talent: { name: "Improved Blink" } } },
          ],
          selected_spec_talents: [
            { id: 62432, rank: 1, tooltip: { talent: { name: "Frozen Touch" } } },
          ],
          selected_hero_talents: [
            { id: 94900, rank: 1, tooltip: { talent: { name: "Rimecaster" } } },
          ],
          selected_hero_talent_tree: { id: 64, name: "Spellslinger" },
        },
      ],
    },
  ],
};

test("los nodos salen del mismo loadout que el código, no de otra spec", () => {
  // El caso que hace falta blindar: si los nodos los eligiera una función
  // aparte, el código sería de Frost y los nodos de Fire, y las dos mitades
  // serían individualmente correctas (ADR 0026).
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Fire" },
          loadouts: [
            {
              is_active: true,
              talent_loadout_code: "CODIGO-FIRE",
              selected_spec_talents: [{ id: 111, tooltip: { talent: { name: "Fuego" } } }],
              selected_hero_talent_tree: { id: 9, name: "Sunfury" },
            },
          ],
        },
        ...FROST_WITH_NODES.specializations,
      ],
    },
    FROST_MAGE,
  );

  assert.equal(result.code, "CODIGO-FROST");
  assert.equal(result.heroTree?.name, "Spellslinger");
  assert.deepEqual(
    result.talents.map((talent) => talent.talentName),
    ["Shimmer", "Improved Blink", "Frozen Touch", "Rimecaster"],
  );
  assert.deepEqual(
    result.talents.map((talent) => talent.tree),
    ["class", "class", "spec", "hero"],
  );
  assert.deepEqual(
    result.talents.map((talent) => talent.rank),
    [1, 2, 1, 1],
  );
});

test("un nodo sin tooltip entra con el nombre a null, no se descarta", () => {
  // La selección está observada; lo que falta es cómo se llama. Descartarla
  // perdería un nodo real por un problema de etiqueta (regla 5).
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Frost" },
          loadouts: [
            {
              is_active: true,
              talent_loadout_code: "C",
              selected_class_talents: [{ id: 99846, rank: 1 }],
            },
          ],
        },
      ],
    },
    FROST_MAGE,
  );

  assert.deepEqual(result.talents, [{ tree: "class", talentId: 99846, talentName: null, rank: 1 }]);
});

test("sin árbol de héroe el loadout sigue valiendo, con heroTree a null", () => {
  // Pasa en ~8% de los loadouts medidos: no invalida los nodos.
  const result = findTalentLoadout(
    {
      specializations: [
        {
          specialization: { name: "Frost" },
          loadouts: [
            {
              is_active: true,
              talent_loadout_code: "C",
              selected_spec_talents: [{ id: 1, tooltip: { talent: { name: "X" } } }],
            },
          ],
        },
      ],
    },
    FROST_MAGE,
  );

  assert.equal(result.outcome, "ok");
  assert.equal(result.heroTree, null);
  assert.equal(result.talents.length, 1);
});

test("los talentos PvP se leen de la spec del bracket aunque no sea la activa", () => {
  const talents = mapPvpTalents(FROST_WITH_NODES, FROST_MAGE);

  assert.deepEqual(talents, [
    { tree: "pvp", talentId: 3517, talentName: "Ice Wall", rank: null },
    { tree: "pvp", talentId: 828, talentName: "Precognition", rank: null },
  ]);
});

test("sin talentos PvP se devuelve null, nunca una lista vacía", () => {
  // `[]` diría "los miramos y no lleva ninguno". La API los omite en ~12% de
  // las entradas de spec, y eso es "no disponible" (regla 5): esos perfiles
  // salen del denominador de PvP sin salir del de nodos.
  assert.equal(
    mapPvpTalents({ specializations: [{ specialization: { name: "Frost" } }] }, FROST_MAGE),
    null,
  );
  assert.equal(
    mapPvpTalents(
      { specializations: [{ specialization: { name: "Frost" }, pvp_talent_slots: [{}] }] },
      FROST_MAGE,
    ),
    null,
  );
  assert.equal(mapPvpTalents({}, FROST_MAGE), null);
});
