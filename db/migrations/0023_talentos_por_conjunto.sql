-- Las selecciones de talento de un árbol se guardan una vez por conjunto (ADR 0040).
--
-- El ADR 0035 ya dejó una fila por (snapshot, árbol) con label_ids y ranks en
-- arrays. Medido el 26 de septiembre de 2026: 122.052 filas y solo 21.376
-- distintas (17,5%). Un árbol elegido es casi siempre el mismo que eligió otro,
-- o el que ese personaje ya llevaba en su perfil anterior. Se guarda el conjunto
-- una vez y el snapshot lo apunta, igual que el gear a sus piezas en 0022.

-- 1) La huella del conjunto. Mismo criterio que gear_piece_fingerprint: JSON
-- para que un ranks null (el de 'pvp', sin rangos) no se confunda con uno vacío.
create or replace function talent_set_fingerprint(tree text, label_ids int[], ranks smallint[])
returns uuid
language sql immutable parallel safe
as $$
  select md5(json_build_array(tree, label_ids, ranks)::text)::uuid
$$;

-- 2) El catálogo de conjuntos. Como talent_labels, al que apunta: no es la
-- observación de nadie, no es append-only y no se poda.
create table talent_sets (
  id          int generated always as identity primary key,
  tree        text       not null check (tree in ('class', 'spec', 'hero', 'pvp')),
  -- Referencias a talent_labels, en el orden en que se observaron.
  label_ids   int[]      not null,
  -- Paralelo a label_ids posición a posición; null entero en 'pvp' (ADR 0026).
  ranks       smallint[],
  fingerprint uuid       not null generated always as (
    talent_set_fingerprint(tree, label_ids, ranks)
  ) stored,
  constraint talent_sets_fingerprint_key unique (fingerprint)
);

comment on table talent_sets is
  'Catálogo de selecciones de un árbol de talentos: (árbol, etiquetas, rangos) una sola vez '
  '(ADR 0040). No es append-only ni se poda; el snapshot la apunta.';

insert into talent_sets (tree, label_ids, ranks)
select distinct tree, label_ids, ranks
  from character_snapshot_talents;

-- 3) La observación, una fila por snapshot. El nombre se conserva por lo mismo
-- que en 0021 y 0022: "el último snapshot con talentos" es un exists sobre ella.
alter table character_snapshot_talents rename to character_snapshot_talents_v2;

create table character_snapshot_talents (
  snapshot_id bigint primary key references character_snapshots(id) on delete cascade,
  -- Un conjunto por árbol observado. El árbol está en el conjunto.
  set_ids     int[]  not null
);

comment on table character_snapshot_talents is
  'Selecciones de talento de un snapshot, una fila por snapshot con referencias a '
  'talent_sets (ADR 0040). Append-only como su padre. La forma por árbol es la vista '
  'character_snapshot_talent_trees.';

insert into character_snapshot_talents (snapshot_id, set_ids)
select t.snapshot_id, array_agg(s.id order by t.tree)
  from character_snapshot_talents_v2 t
  join talent_sets s on s.fingerprint = talent_set_fingerprint(t.tree, t.label_ids, t.ranks)
 group by t.snapshot_id;

-- 4) La forma del ADR 0035, una fila por (snapshot, árbol), para quien la lee:
-- la ficha, los agregados y el archivado, que sigue subiendo lo mismo que antes.
create view character_snapshot_talent_trees with (security_invoker = true) as
select t.snapshot_id, s.tree, s.label_ids, s.ranks
  from character_snapshot_talents t
  cross join lateral unnest(t.set_ids) as u(set_id)
  join talent_sets s on s.id = u.set_id;

comment on view character_snapshot_talent_trees is
  'Las selecciones de cada snapshot una fila por árbol, con las columnas de la tabla del '
  'ADR 0035. Es lo que leen la ficha, los agregados y el archivado.';

-- 5) Idéntico en los dos sentidos o no se borra nada.
do $$
declare
  missing bigint;
  extra   bigint;
begin
  select count(*) into missing from (
    select snapshot_id, tree, label_ids, ranks from character_snapshot_talents_v2
    except all
    select * from character_snapshot_talent_trees
  ) x;
  select count(*) into extra from (
    select * from character_snapshot_talent_trees
    except all
    select snapshot_id, tree, label_ids, ranks from character_snapshot_talents_v2
  ) x;
  if missing > 0 or extra > 0 then
    raise exception 'talentos por conjunto: % filas perdidas y % de más; no se borra nada',
      missing, extra;
  end if;
end $$;

drop table character_snapshot_talents_v2;
