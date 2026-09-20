-- El histórico frío de character_snapshots sale de Postgres (ADR 0034).
--
-- La base estaba en 961 MB contra una cuota de 500, y el 82% eran las tres
-- tablas de observación. El 80% de las filas de `character_snapshots` tenía más
-- de 14 días: no es la más reciente de nadie y ninguna consulta del producto la
-- lee, pero vivía en los mismos índices que la consulta caliente y les pagaba el
-- peaje a cada inserción. Pasa a Supabase Storage, que es cuota aparte dentro
-- del mismo proyecto, y se borra de aquí.
--
-- El trabajo lo hace `npm run pipeline -- archive-snapshots`. Esta migración
-- solo añade lo que ese job necesita para que borrar no sea perder.

-- 1) Cuántas observaciones de cada serie viven ya solo en el archivo.
--
--    `refresh-activity` deja de ver esas filas, y lo que se sabía de ellas —la
--    fecha de arranque, una subida vieja del contador— pasa a heredarse de la
--    fila anterior de esta misma tabla. El recuento es lo único que no se puede
--    heredar así: la fila guarda el total, no qué parte de él sigue caliente. Lo
--    mueve el archivado, en la misma transacción que borra las filas que cuenta,
--    y el recálculo no lo toca nunca.
alter table character_activity
  add column if not exists archived_observations int not null default 0;

comment on column character_activity.archived_observations is
  'Observaciones de esta serie que ya no están en character_snapshots porque se '
  'archivaron (ADR 0034). observations = estas + las que siguen calientes.';

comment on table character_activity is
  'Actividad derivada por personaje, bracket y temporada (ADR 0008). Derivada pero '
  'NO reconstruible desde cero desde el ADR 0034: lo que se sabía del histórico '
  'archivado vive solo aquí. No se vacía.';

-- 2) La bitácora del archivo: qué se sacó, cuándo y dónde está.
--
--    Es el índice del archivo. Sin ella, reconstruir algún día el histórico sería
--    listar el bucket y adivinar; con ella, cada lote dice qué rango de fechas
--    cubre y cuántas filas de cada tabla tiene que encontrar quien lo lea.
create table if not exists snapshot_archive_batches (
  -- Carpeta del lote dentro del bucket: `<corrida>/<lote>`. Dentro, un fichero
  -- NDJSON comprimido por tabla.
  object_prefix     text        primary key,
  archived_at       timestamptz not null default now(),
  -- El corte de la corrida: todo lo archivado es anterior a él.
  cutoff            timestamptz not null,
  snapshots         int         not null,
  gear_rows         int         not null,
  talent_rows       int         not null,
  first_captured_at timestamptz not null,
  last_captured_at  timestamptz not null
);

comment on table character_snapshots is
  'Observaciones append-only (ADR 0002). Desde el ADR 0034 solo guarda los últimos '
  '14 días más las filas que alguien sigue leyendo —el ancla por origen, el último '
  'gear, los últimos talentos y el pico de cada serie—; el resto está archivado en '
  'Supabase Storage (ver snapshot_archive_batches).';
