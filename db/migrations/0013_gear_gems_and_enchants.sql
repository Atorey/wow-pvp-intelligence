-- Gemas y encantamientos como variables agregables (§16 del plan, ADR 0027).
--
-- Los ids llevan guardados desde la 0002 y nunca se han agregado: `character_
-- snapshot_gear` los recoge en cada perfil y `AggregateVariableKind` solo conocía
-- el item. Lo que faltaba para poder enseñarlos no era el dato, era el nombre —
-- y ese también llega en la misma respuesta de `/equipment` que ya descargamos.
--
-- No hay denominador nuevo. Al contrario que los nodos de talento (ADR 0026),
-- gemas y encantamientos salen de la misma fila que el item, con `not null
-- default '{}'` desde el primer día: si leímos su equipo, leímos sus gemas.
-- `gear_sample` es la base de las tres variables.

-- 1) Los nombres, paralelos por posición a los ids que ya había.
--
-- Arrays y no una tabla aparte porque los ids ya son arrays de esta misma fila:
-- una tabla espejo obligaría a mantener dos formas para lo que la API entrega
-- junto. La correspondencia por posición la garantiza `mapEquipment`, que
-- construye cada par en la misma pasada.
alter table character_snapshot_gear
  add column if not exists enchantment_names text[] not null default '{}',
  add column if not exists gem_item_names    text[] not null default '{}';

comment on column character_snapshot_gear.gem_item_names is
  'Nombres de las gemas, paralelos por posición a gem_item_ids. Un null es "no '
  'disponible" (regla 5). Vacío en los snapshots anteriores a esta migración: el '
  'adoption_rate ya se podía calcular con los ids, el nombre empieza aquí.';

comment on column character_snapshot_gear.enchantment_names is
  'Nombres de los encantamientos, paralelos por posición a enchantment_ids. Salen '
  'del display_string de la API, sin el prefijo ni el marcador de icono.';

-- 2) Las dos variables nuevas. El conjunto sigue cerrado: añadir una es tocar
-- este check y el tipo de packages/core. Stats secundarias y embellishments
-- siguen fuera porque el schema no las guarda.
alter table aggregate_snapshots
  drop constraint if exists aggregate_snapshots_variable_kind_check;

alter table aggregate_snapshots
  add constraint aggregate_snapshots_variable_kind_check
    check (variable_kind in ('gear-item', 'gear-gem', 'gear-enchant',
                             'talent-code', 'talent-node', 'pvp-talent', 'hero-tree'));

comment on column aggregate_snapshots.variable_key is
  'Clave estable dentro del segmento: ''TRINKET:207581'' (gear-item), '
  '''gem:240914'' (gear-gem), ''enchant:7991'' (gear-enchant), ''class:99846'' '
  '(talent-node), ''pvp:3755'' (pvp-talent), el id del árbol (hero-tree) o el '
  'talent_loadout_code completo (talent-code).';

comment on column aggregate_snapshots.slot_group is
  'Grupo de slots normalizado (''TRINKET'', nunca ''TRINKET_1''). null fuera de '
  'gear-item: una gema o un encantamiento no se comparan por hueco, y agruparlos '
  'por slot partiría en dos la adopción de un encantamiento de anillo.';

comment on column aggregate_snapshots.item_id is
  'item_id en gear-item y gear-gem —una gema es un item, y por eso hereda el '
  'catálogo de iconos—. null en gear-enchant, que no lo es, y en los talentos.';

-- 3) El encantamiento no cabe en item_id/item_name, y no por purismo: readAdoption
-- junta item_media por item_id, así que un enchantment_id guardado ahí cruzaría
-- con el item que compartiera ese número y pintaría su icono. Par propio, como
-- 0012 se lo dio a los talentos en vez de inventar un variable_label común.
alter table aggregate_snapshots
  add column if not exists enchantment_id   bigint,
  add column if not exists enchantment_name text;

comment on column aggregate_snapshots.enchantment_id is
  'Id del encantamiento en gear-enchant; null en todo lo demás. Aparte de item_id '
  'porque no es un item: cruzarlos daría iconos de otra cosa.';
