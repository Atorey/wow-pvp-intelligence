-- Talentos observados por nodo, no por código de loadout (#21, ADR 0026).
--
-- El `talent_loadout_code` de 0002 sigue donde estaba: lo que cambia es que deja
-- de ser la única lectura de talentos. Agregado por coincidencia exacta no
-- agrupa nada —entre 75 y 97 códigos distintos por cada 100 perfiles de un
-- segmento— así que el porcentaje describe personas y no escalones.
--
-- Los nodos no hay que decodificarlos: la respuesta de /specializations que ya
-- descargamos trae `selected_class_talents`, `selected_spec_talents`,
-- `selected_hero_talents`, `selected_hero_talent_tree` y `pvp_talent_slots` ya
-- resueltos. Solo los estábamos tirando.

-- 1) Los nodos de un snapshot. Espejo de character_snapshot_gear: tabla hija,
-- misma cascada, y una fila por selección observada.
create table if not exists character_snapshot_talents (
  snapshot_id bigint not null references character_snapshots(id) on delete cascade,
  -- Namespace del id, no solo etiqueta: para class/spec/hero es el nodo del
  -- árbol y para pvp es el pvp-talent, que son espacios de ids distintos y
  -- podrían colisionar en la clave primaria.
  tree        text   not null check (tree in ('class', 'spec', 'hero', 'pvp')),
  talent_id   bigint not null,
  -- null es "no disponible" (regla 5), no "sin nombre": la API devuelve algún
  -- nodo sin tooltip y ese nodo sí está observado, solo que no sabemos llamarlo.
  talent_name text,
  -- Puntos invertidos en el nodo. null en 'pvp', que no tiene rangos.
  -- Se guarda y no se agrega: la variable es "lleva Frozen Touch", y llevarlo a
  -- uno o a dos puntos es señal adicional que todavía no entra (ADR 0026).
  rank        int,
  primary key (snapshot_id, tree, talent_id)
);

comment on table character_snapshot_talents is
  'Nodos de talento observados en un snapshot de perfil. Salen del mismo loadout que '
  'character_snapshots.talent_loadout_code (ADR 0026). Append-only como su padre.';

-- 2) El árbol de héroe es un escalar del loadout, no un nodo: una sola elección
-- entre dos por spec. Va donde va el código, por lo mismo que él.
alter table character_snapshots
  add column if not exists hero_talent_tree_id   int,
  add column if not exists hero_talent_tree_name text;

comment on column character_snapshots.hero_talent_tree_id is
  'Árbol de héroe elegido en el loadout de la spec del bracket. null = no disponible '
  '(la API no lo trae en ~8% de los loadouts), nunca "no eligió".';

-- 3) Denominadores nuevos, junto a gear_sample y talent_sample de 0005.
--
-- Tres cifras y no una porque divergen: el código está guardado desde agosto y
-- los nodos empiezan hoy, así que durante días habrá segmentos con
-- talent_sample = 100 y talent_node_sample = 0. Y los talentos PvP faltan en
-- ~12% de las entradas de spec por una razón que no tiene nada que ver con el
-- loadout. Fundirlos daría un número que no describe a ninguna de las tres.
alter table population_segments
  add column if not exists talent_node_sample int not null default 0,
  add column if not exists pvp_talent_sample  int not null default 0;

comment on column population_segments.talent_node_sample is
  'Miembros del segmento de los que tenemos nodos de talento. No es talent_sample: ese '
  'cuenta quién tiene código, que es un dato más viejo y más disponible (ADR 0026).';

-- 4) Las variables nuevas. El conjunto sigue cerrado —añadir una es tocar este
-- check y el tipo de packages/core, no meter cualquier cosa en un cajón
-- genérico— pero ya no son dos. Stats secundarias y embellishments siguen fuera
-- porque el schema no las guarda.
alter table aggregate_snapshots
  drop constraint if exists aggregate_snapshots_variable_kind_check;

alter table aggregate_snapshots
  add constraint aggregate_snapshots_variable_kind_check
    check (variable_kind in ('gear-item', 'talent-code', 'talent-node', 'pvp-talent', 'hero-tree'));

-- Trío paralelo a slot_group / item_id / item_name, que ya son nullable según el
-- kind. Se descartó un `variable_label` común: dejaría item_name huérfano y haría
-- más vagos los dos lados a cambio de una columna.
alter table aggregate_snapshots
  add column if not exists talent_tree text,
  add column if not exists talent_id   bigint,
  add column if not exists talent_name text;

comment on column aggregate_snapshots.talent_tree is
  '''class'' | ''spec'' | ''hero'' | ''pvp''. null en gear-item, talent-code y hero-tree.';

comment on column aggregate_snapshots.variable_key is
  'Clave estable dentro del segmento: ''TRINKET:207581'' (gear-item), ''class:99846'' '
  '(talent-node), ''pvp:3755'' (pvp-talent), el id del árbol (hero-tree) o el '
  'talent_loadout_code completo (talent-code).';

-- El índice de 0005 sigue sirviendo: es (variable_kind, variable_key), y la
-- pregunta "cómo ha evolucionado la adopción de este nodo" tiene la misma forma
-- que la del item.
