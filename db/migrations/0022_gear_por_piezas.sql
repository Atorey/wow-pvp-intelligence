-- El gear de un snapshot deja de ser una fila por slot (ADR 0040).
--
-- Medido el 26 de septiembre de 2026 con `db-size --detail`: 168 MB, la segunda
-- tabla más cara de la base, con 628.212 filas de slot para 38.420 snapshots.
-- De esas filas solo **65.432 son distintas** (10,4%): la misma pieza —mismo
-- item, item level, encantamiento, gemas y bonus— se repite en miles de
-- personajes y en cada refresco del mismo. Lo que no se repite es el equipo
-- entero (94,9% distintos), así que lo que se guarda una vez es la pieza, no el
-- equipo. Es el movimiento del ADR 0035 con los talentos, aplicado al gear.
--
-- No cambia qué es una observación: cada snapshot de perfil sigue teniendo su
-- fila de gear, y nada se actualiza (ADR 0002). Cambia dónde vive el contenido.

-- 1) La huella de una pieza: todo lo que se guarda de ella, nulls incluidos.
--
-- json_build_array y no una concatenación: distingue null de la cadena 'null' y
-- un array vacío de uno ausente, así que dos piezas con la misma huella son la
-- misma pieza y no dos que se parecen al escribirse. Se declara immutable porque
-- lo es para estos tipos —ningún ajuste de sesión cambia cómo se escriben un
-- entero o un texto en JSON— y es lo que exige una columna generada.
create or replace function gear_piece_fingerprint(
  slot text, item_id bigint, item_name text, item_level int, quality text,
  enchantment_ids int[], enchantment_names text[], gem_item_ids int[],
  gem_item_names text[], bonus_list int[]
) returns uuid
language sql immutable parallel safe
as $$
  select md5(json_build_array(slot, item_id, item_name, item_level, quality,
                              enchantment_ids, enchantment_names, gem_item_ids,
                              gem_item_names, bonus_list)::text)::uuid
$$;

-- 2) El catálogo de piezas.
--
-- No es append-only ni le aplica la regla 1, por lo mismo que a talent_labels:
-- no es la observación de nadie. Tampoco se poda: una pieza puede sostener
-- snapshots que siguen calientes aunque ya nadie la lleve, y comprobarlo cada
-- noche costaría más de lo que ocupa. Las columnas son las de 0002 y 0013, con
-- su misma semántica de null (regla 5).
create table gear_pieces (
  id                int generated always as identity primary key,
  -- El slot va en la pieza y no en el snapshot: TRINKET_1 y TRINKET_2 con el
  -- mismo abalorio son dos piezas, igual que eran dos filas.
  slot              text   not null,
  item_id           bigint not null,
  item_name         text,
  item_level        int,
  quality           text,
  enchantment_ids   int[]  not null default '{}',
  enchantment_names text[] not null default '{}',
  gem_item_ids      int[]  not null default '{}',
  gem_item_names    text[] not null default '{}',
  bonus_list        int[]  not null default '{}',
  -- La unicidad va por la huella y no por las diez columnas: un índice sobre
  -- ellas ocuparía tanto como la tabla, que es justo lo que se está quitando.
  fingerprint       uuid   not null generated always as (
    gear_piece_fingerprint(slot, item_id, item_name, item_level, quality,
                           enchantment_ids, enchantment_names, gem_item_ids,
                           gem_item_names, bonus_list)
  ) stored,
  constraint gear_pieces_fingerprint_key unique (fingerprint)
);

comment on table gear_pieces is
  'Catálogo de piezas de equipo observadas: item con su item level, encantamientos, gemas '
  'y bonus en un slot (ADR 0040). No es append-only ni se poda; el snapshot la apunta.';

insert into gear_pieces (slot, item_id, item_name, item_level, quality, enchantment_ids,
                         enchantment_names, gem_item_ids, gem_item_names, bonus_list)
select distinct slot, item_id, item_name, item_level, quality, enchantment_ids,
       enchantment_names, gem_item_ids, gem_item_names, bonus_list
  from character_snapshot_gear;

-- 3) La tabla de observación, ahora una fila por snapshot.
--
-- Conserva el nombre, como hizo 0021: el archivado y la ficha buscan "el último
-- snapshot con gear" con un exists sobre ella, y esa pregunta no cambia. El
-- índice de la clave vieja se renombra para que la nueva pueda llevar el suyo.
alter table character_snapshot_gear rename to character_snapshot_gear_v1;
alter index character_snapshot_gear_pkey rename to character_snapshot_gear_v1_pkey;

create table character_snapshot_gear (
  snapshot_id bigint primary key references character_snapshots(id) on delete cascade,
  -- Sin orden que signifique nada: el slot está en la pieza, y quien pinta el
  -- equipo lo ordena con compareGearSlots().
  piece_ids   int[]  not null
);

comment on table character_snapshot_gear is
  'Equipo de un snapshot, una fila por snapshot con referencias a gear_pieces (ADR 0040). '
  'Append-only como su padre. La forma por slot es la vista character_snapshot_gear_slots.';

insert into character_snapshot_gear (snapshot_id, piece_ids)
select g.snapshot_id, array_agg(p.id order by g.slot)
  from character_snapshot_gear_v1 g
  join gear_pieces p
    on p.fingerprint = gear_piece_fingerprint(g.slot, g.item_id, g.item_name, g.item_level,
                                              g.quality, g.enchantment_ids, g.enchantment_names,
                                              g.gem_item_ids, g.gem_item_names, g.bonus_list)
 group by g.snapshot_id;

-- 4) La forma de siempre, para quien lee por slot.
--
-- Los lectores —la ficha, los agregados, el archivo— siguen viendo una fila por
-- slot con las mismas columnas y en el mismo orden que la tabla de 0013. Para el
-- archivo es lo que importa: sigue escribiendo el formato de antes y un lote no
-- necesita este catálogo para leerse, al contrario que los de talentos.
create view character_snapshot_gear_slots with (security_invoker = true) as
select g.snapshot_id, p.slot, p.item_id, p.item_name, p.item_level, p.quality,
       p.enchantment_ids, p.gem_item_ids, p.bonus_list, p.enchantment_names,
       p.gem_item_names
  from character_snapshot_gear g
  cross join lateral unnest(g.piece_ids) as u(piece_id)
  join gear_pieces p on p.id = u.piece_id;

comment on view character_snapshot_gear_slots is
  'El gear de cada snapshot una fila por slot, con las columnas de la tabla anterior al '
  'ADR 0040. Es lo que leen la ficha, los agregados y el archivado.';

-- 5) Nada se pierde, o no se borra nada.
--
-- Comparación en los dos sentidos y con multiplicidad (except all): si una sola
-- fila de slot no sale idéntica de la vista, la migración entera se deshace y la
-- tabla vieja sigue donde estaba.
do $$
declare
  missing bigint;
  extra   bigint;
begin
  select count(*) into missing from (
    select snapshot_id, slot, item_id, item_name, item_level, quality, enchantment_ids,
           gem_item_ids, bonus_list, enchantment_names, gem_item_names
      from character_snapshot_gear_v1
    except all
    select * from character_snapshot_gear_slots
  ) x;
  select count(*) into extra from (
    select * from character_snapshot_gear_slots
    except all
    select snapshot_id, slot, item_id, item_name, item_level, quality, enchantment_ids,
           gem_item_ids, bonus_list, enchantment_names, gem_item_names
      from character_snapshot_gear_v1
  ) x;
  if missing > 0 or extra > 0 then
    raise exception 'gear por piezas: % filas de slot perdidas y % de más; no se borra nada',
      missing, extra;
  end if;
end $$;

drop table character_snapshot_gear_v1;
