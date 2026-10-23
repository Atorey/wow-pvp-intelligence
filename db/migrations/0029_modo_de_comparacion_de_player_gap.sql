-- Contra qué escalón se comparó cada vista de Player Gap (ADR 0051).
--
-- Hasta el ADR 0051 el objetivo era siempre el inmediato. Ahora puede ser el de
-- encima cuando el inmediato no tiene base, o el propio tramo cuando no la tiene
-- ninguno de arriba, y esas dos son otra promesa: una North Star que las contara
-- igual que «el siguiente escalón» subiría sin que el producto hiciera más de lo
-- que prometía. Con la columna, la métrica se calcula con y sin ellas.
--
-- Nullable y sin default: añadir la columna no reescribe la tabla. null en
-- 'top-segment', que no tiene objetivo, y en las filas anteriores a esta
-- migración, que son todas 'next' aunque no lo digan: entonces no había otro.
alter table player_gap_views
  add column if not exists target_mode text;

alter table player_gap_views
  drop constraint if exists player_gap_views_target_mode_check;
alter table player_gap_views
  add constraint player_gap_views_target_mode_check
  check (target_mode in ('next', 'skipped', 'peers')) not valid;

comment on column player_gap_views.target_mode is
  'Contra qué escalón se comparó (ADR 0051): ''next'' el inmediato, ''skipped'' '
  'el de encima porque el inmediato no tenía base, ''peers'' el propio tramo '
  'porque no la tenía ninguno de arriba. null en top-segment y en las filas '
  'anteriores a la migración 0029, que son todas ''next''.';

comment on column player_gap_views.target_segment is
  'Slug del segmento objetivo: el inmediato, el saltado o el propio según '
  'target_mode. null en top-segment, que es el caso en el que no hay objetivo.';
