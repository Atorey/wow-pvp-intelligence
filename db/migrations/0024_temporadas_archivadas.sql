-- Una temporada cerrada sale de Postgres entera (ADR 0042).
--
-- Sus snapshots van al archivo por el camino de siempre, `snapshot_archive_batches`
-- incluido, y dejan su rating en el índice por personaje (ADR 0039). Lo que no
-- tenía bitácora eran sus tablas derivadas —actividad, presencia, segmentos,
-- agregados y cobertura—, que se archivan una vez por temporada. Esta tabla es
-- esa bitácora, y es también lo que la web mira para saber que la ficha de
-- alguien que solo jugó una temporada cerrada se lee de Storage.
create table if not exists archived_seasons (
  season_id      int         primary key,
  archived_at    timestamptz not null default now(),
  -- Carpeta del bucket con los ficheros de la última corrida que la tocó:
  -- `seasons/s<temporada>/<corrida>/<tabla>-<nnnn>.ndjson.gz`.
  object_prefix  text        not null,
  -- Filas movidas por tabla. Si una corrida posterior encuentra restos de la
  -- misma temporada, se suman.
  activity_rows  int         not null default 0,
  presence_rows  int         not null default 0,
  segment_rows   int         not null default 0,
  aggregate_rows int         not null default 0,
  coverage_rows  int         not null default 0
);

comment on table archived_seasons is
  'Temporadas cerradas cuyas filas ya no están en Postgres (ADR 0042). Sus snapshots '
  'constan en snapshot_archive_batches; sus tablas derivadas, aquí.';
