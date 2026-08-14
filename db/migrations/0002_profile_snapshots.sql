-- Perfiles completos: gear y talentos.
--
-- El leaderboard solo trae rating; para Player Gap hacen falta las variables que
-- de verdad se comparan (gear por slot, talentos). Un snapshot con source='profile'
-- es el mismo concepto que uno de leaderboard, solo que con más columnas rellenas:
-- no se crea una tabla paralela, para que el histórico de un personaje siga siendo
-- una única línea temporal (§27 del plan).

-- 1) Idempotencia de la ingesta. captured_at viene del `fetchedAt` del archivo
--    descargado, así que reingerir el mismo archivo choca aquí y no duplica
--    población (lo que inflaría los tamaños de muestra y, con ellos, la
--    confianza declarada — justo lo que el producto promete no hacer).
--
--    Si esto falla porque ya hay duplicados de una ingesta anterior, límpialos
--    antes con:
--      delete from character_snapshots a using character_snapshots b
--       where a.id > b.id and a.character_id = b.character_id
--         and a.bracket = b.bracket and a.captured_at = b.captured_at;
create unique index if not exists idx_snapshots_unique_capture
  on character_snapshots (character_id, bracket, captured_at);

-- 2) Datos que solo llegan del perfil completo, no del leaderboard.
alter table character_snapshots
  add column if not exists average_item_level  int,
  add column if not exists equipped_item_level int,
  -- Riesgo activo (§30): puede venir null. Null significa "no disponible para
  -- este personaje", nunca "no lleva talentos" — el cálculo de adoption_rate
  -- debe excluir estas filas del denominador, no contarlas como no-adopción.
  add column if not exists talent_loadout_code text;

-- 3) Gear por slot. Una fila por slot equipado en ese snapshot.
create table if not exists character_snapshot_gear (
  snapshot_id     bigint not null references character_snapshots(id) on delete cascade,
  slot            text   not null,          -- 'HEAD', 'TRINKET_1', ...
  item_id         bigint not null,
  item_name       text,
  item_level      int,
  quality         text,                     -- 'EPIC' | 'RARE' | ...
  enchantment_ids int[]  not null default '{}',
  gem_item_ids    int[]  not null default '{}',
  bonus_list      int[]  not null default '{}',
  primary key (snapshot_id, slot)
);

-- Adoption rate por item: "qué % del segmento lleva este item en este slot".
create index if not exists idx_gear_item on character_snapshot_gear (item_id, slot);
