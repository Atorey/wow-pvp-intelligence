-- El último contador de partidas de leaderboard que vio el recálculo de
-- actividad, para que el archivado pueda soltar el ancla (ADR 0054, punto 6).
--
-- La subida del contador se mide contra la observación anterior del mismo
-- origen. Con el ancla de leaderboard en character_snapshots, esa observación
-- siempre estaba; copiada en character_presence, también, hasta que el jugador
-- vuelve a jugar: entonces la presencia pasa a apuntar a la fila nueva, la
-- anterior ya solo está en el archivo, y la primera subida no tendría contra qué
-- compararse. El jugador saldría inactivo justo el día que juega.
--
-- Esto la guarda donde ya se guarda lo que se sabía de la parte archivada de la
-- serie: refresh-activity la escribe en cada recálculo y la vuelve a leer como
-- una observación más. Nullable y sin default: no reescribe la tabla, y la
-- rellena el primer recálculo, que corre antes que el archivado en el mismo
-- workflow. Mientras sea null, el archivado no suelta el ancla.
alter table character_activity
  add column if not exists leaderboard_played      int,
  add column if not exists leaderboard_observed_at timestamptz;

comment on column character_activity.leaderboard_played is
  'Contador de partidas de la última observación de leaderboard con contador que vio '
  'el recálculo (ADR 0054). Es el listón de la siguiente subida, y solo se compara con '
  'otros contadores de leaderboard (ADR 0008).';

comment on column character_activity.leaderboard_observed_at is
  'captured_at de esa observación. El archivado solo suelta el ancla de leaderboard si '
  'esta fecha la alcanza: hasta entonces, la actividad todavía la necesita.';
