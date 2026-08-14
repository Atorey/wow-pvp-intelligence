import assert from "node:assert/strict";
import { test } from "node:test";
import { requireSpec } from "@wowpvp/core";
import { findTalentLoadout, mapEquipment, specNameToSlug } from "./profile-mapping";

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

  assert.deepEqual(result, { code: "CODIGO-FROST", outcome: "ok" });
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

  assert.deepEqual(result, { code: "UNICO", outcome: "ok" });
});

test("los motivos de null se distinguen entre sí", () => {
  // El riesgo del parche 11.2 es 'no-code': la API responde y aun así no trae
  // el código. Confundirlo con 'spec-not-listed' borraría el dato que este
  // muestreo viene a medir.
  assert.deepEqual(
    findTalentLoadout({ specializations: [{ specialization: { name: "Fire" } }] }, FROST_MAGE),
    { code: null, outcome: "spec-not-listed" },
  );
  assert.deepEqual(
    findTalentLoadout(
      { specializations: [{ specialization: { name: "Frost" }, loadouts: [] }] },
      FROST_MAGE,
    ),
    { code: null, outcome: "no-loadout" },
  );
  assert.deepEqual(
    findTalentLoadout(
      { specializations: [{ specialization: { name: "Frost" }, loadouts: [{ is_active: true }] }] },
      FROST_MAGE,
    ),
    { code: null, outcome: "no-code" },
  );
  assert.deepEqual(findTalentLoadout({}, FROST_MAGE), { code: null, outcome: "spec-not-listed" });
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
