-- Los nodos de un snapshot dejan de ser una fila cada uno (ADR 0035).
--
-- La tabla de 0012 es la más cara del proyecto: 201 MB para 22.350 snapshots,
-- 79 filas por snapshot. Lo que pesa no es el dato —solo hay 3.515 etiquetas
-- distintas— sino repetir el nombre y pagar cabecera de fila y entrada de
-- índice 1,77 millones de veces. El nodo sigue siendo la unidad de agregación
-- del ADR 0026: lo que cambia es cómo se guarda, no qué se mide.

-- 1) Catálogo de etiquetas.
--
-- La clave es (tree, node_id, name) y no el nodo a secas, que es lo que parecía
-- obvio. Un nodo de elección son dos talentos bajo el mismo id: el 62087 es
-- "Ice Nova" en 1.737 observaciones y "Freezing Cold" en 67, y lo mismo pasa en
-- 338 nodos que cubren 29.018 observaciones. Un catálogo por nodo tendría que
-- quedarse con uno de los dos nombres, y eso no es comprimir: es afirmar que
-- alguien eligió lo que no eligió.
--
-- No es append-only y no le aplica la regla 1, por lo mismo que a item_media
-- (ADR 0022): no es la observación de nadie, es la etiqueta de un hecho del
-- juego. La fila nunca se borra —el archivo de Storage guarda label_ids y los
-- resuelve contra esta tabla—, así que tampoco hay poda que escribir.
create table if not exists talent_labels (
  id      int generated always as identity primary key,
  tree    text not null check (tree in ('class', 'spec', 'hero', 'pvp')),
  -- El nodo del árbol en class/spec/hero y el pvp-talent en pvp. Espacios de
  -- ids distintos, y por eso el árbol va en la clave: hay ids que aparecen en
  -- class y en hero.
  node_id int not null,
  -- null es "no disponible" (regla 5): la API deja sin tooltip un nodo por
  -- loadout, y ese nodo sí está observado.
  name    text,
  -- El id del talento elegido, que es de lo que el nombre es función. Lo trae
  -- `tooltip.talent.id` y 0012 lo tiraba. null en todo lo migrado de 0012, que
  -- nunca lo guardó: "no disponible", no "no tiene".
  talent_id int,
  -- nulls not distinct porque el nombre ausente es una etiqueta más y no puede
  -- duplicarse: sin esto habría una fila por cada snapshot sin tooltip.
  unique nulls not distinct (tree, node_id, name)
);

comment on table talent_labels is
  'Catálogo (árbol, nodo, nombre) → id. La clave lleva el nombre porque un nodo de elección '
  'son dos talentos con el mismo node_id (ADR 0035). No es append-only ni se poda.';

insert into talent_labels (tree, node_id, name)
select distinct tree, talent_id::int, talent_name
  from character_snapshot_talents;

-- 2) La tabla de observación, ahora una fila por (snapshot, árbol).
--
-- Se conserva el nombre: el archivado hace `select *` sobre ella y la ficha del
-- jugador la busca por snapshot_id, así que lo que cambia es la forma, no quién
-- la usa. El árbol sigue siendo columna y no se deduce de las etiquetas porque
-- los denominadores del ADR 0026 se separan por él —talent_node_sample cuenta
-- nodos y pvp_talent_sample cuenta talentos PvP— y esa pregunta tiene que
-- contestarse sin abrir los arrays.
alter table character_snapshot_talents rename to character_snapshot_talents_v1;

create table character_snapshot_talents (
  snapshot_id bigint not null references character_snapshots(id) on delete cascade,
  tree        text   not null check (tree in ('class', 'spec', 'hero', 'pvp')),
  -- Las selecciones observadas, como referencias al catálogo.
  label_ids   int[]  not null,
  -- Puntos invertidos, paralelo a label_ids posición a posición. null entero en
  -- 'pvp', que no tiene rangos; un null suelto dentro del array sería un nodo
  -- cuyo rango no llegó. Se guarda y no se agrega (ADR 0026).
  ranks       smallint[],
  primary key (snapshot_id, tree)
);

comment on table character_snapshot_talents is
  'Selecciones de talento de un snapshot, una fila por árbol (ADR 0035). Append-only como '
  'su padre. label_ids apunta a talent_labels; ranks va en paralelo, posición a posición.';

-- El coalesce con chr(1) es para que el join sea hashable: `is not distinct
-- from` obliga a un nested loop sobre 1,77 millones de filas.
insert into character_snapshot_talents (snapshot_id, tree, label_ids, ranks)
select v.snapshot_id,
       v.tree,
       array_agg(l.id order by v.talent_id),
       case when v.tree = 'pvp' then null
            else array_agg(v.rank::smallint order by v.talent_id) end
  from character_snapshot_talents_v1 v
  join talent_labels l
    on l.tree = v.tree
   and l.node_id = v.talent_id::int
   and coalesce(l.name, chr(1)) = coalesce(v.talent_name, chr(1))
 group by v.snapshot_id, v.tree;

drop table character_snapshot_talents_v1;
