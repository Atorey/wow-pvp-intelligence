-- El histórico de agregados deja de guardarse entero, y el reparto de códigos
-- deja de guardarse fila a fila.
--
-- `aggregate_snapshots` era la tabla que más crecía del proyecto: ~75.000 filas
-- por corrida diaria, todas conservadas, unos 19 MB al día — la mitad del
-- crecimiento total de la base. Y es la tabla que la migración 0005 declaró
-- derivada en su propia cabecera: se reconstruye entera desde
-- `character_snapshots`, así que borrar un recálculo no destruye histórico de
-- población. Borrar un snapshot, sí; eso sigue prohibido (ADR 0002).
--
-- Tres cosas, medidas sobre la base del 19 de septiembre de 2026:
--
-- 1) El 92,8% de las filas `talent-code` (94.184 de 101.542) tenía **un solo
--    usuario**. El ADR 0026 ya había dicho que agregar por código no agrupa
--    nada —entre 75 y 97 códigos distintos por cada 100 perfiles— y el ADR 0003
--    impide enseñar una comparación por debajo de n=30: esas filas describen a
--    una persona y ninguna pantalla puede publicarlas. Lo que sí valía de ellas
--    era el reparto, y el reparto es un entero por segmento, no una fila por
--    código. Pasa a `population_segments.talent_code_distinct`.
--
-- 2) `aggregate_snapshots.id` era un `bigserial` que no referencia nadie —la
--    clave real es el `unique (population_segment_id, variable_kind,
--    variable_key)` de 0005— y su índice ocupaba 15 MB para **un solo uso**
--    registrado en `pg_stat_user_indexes`. Se quita la columna y el único
--    índice pasa a ser la primary key, sin reconstruirlo.
--
-- 3) La retención en sí no vive aquí, porque no es schema: la aplica
--    `npm run pipeline -- prune-aggregates` al final de cada recálculo. Esta
--    migración solo deja la base en el estado del que parte esa política.

-- 1) El reparto de códigos, antes de borrar las filas de las que se deduce.
alter table population_segments
  add column if not exists talent_code_distinct int not null default 0;

comment on column population_segments.talent_code_distinct is
  'Códigos de loadout distintos observados en el segmento. Sobre talent_sample da '
  '"cuántas builds distintas por cada cien perfiles", que es la medida de la división '
  'del ADR 0026. No es un denominador: no es base de ninguna comparación.';

update population_segments ps
   set talent_code_distinct = sub.n
  from (
    select population_segment_id, count(*) as n
      from aggregate_snapshots
     where variable_kind = 'talent-code'
     group by population_segment_id
  ) sub
 where sub.population_segment_id = ps.id
   and ps.talent_code_distinct = 0;

-- 2) Fuera las filas que describen a una persona. El umbral vive en
--    `aggregateTalentCodes()` de packages/core; aquí solo se limpia lo ya escrito.
delete from aggregate_snapshots
 where variable_kind = 'talent-code'
   and users < 2;

-- 3) La clave sintética que nadie usaba.
--
-- `drop column` se lleva por delante la primary key y su secuencia. No se
-- promueve el índice único a primary key en su lugar: ya es una constraint
-- `unique` desde 0005 y Postgres no deja reutilizar un índice que ya está
-- asociado a una. Convertirla obligaría a reconstruir el índice, que es
-- exactamente lo que no se puede hacer con 500 MB de cuota y la base por
-- encima — y no compra nada: la unicidad ya está garantizada.
--
-- Lo que sí hace falta es dejar dicho qué identifica una fila ahora que no hay
-- primary key. Sin `replica identity`, un `delete` sobre una tabla publicada
-- falla, y esta tabla se poda todos los días.
alter table aggregate_snapshots
  drop column if exists id;

alter table aggregate_snapshots
  replica identity using index aggregate_snapshots_population_segment_id_variable_kind_var_key;

comment on table aggregate_snapshots is
  'adoption_rate por variable y escalón. Tabla DERIVADA y con retención: la corrida '
  'más reciente se guarda entera y de las anteriores solo sobrevive lo que podría '
  'volver a enseñarse (ver prune-aggregates). La fuente de verdad es '
  'character_snapshots, que no se poda.';
