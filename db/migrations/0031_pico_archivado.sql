-- El pico de cada serie se hereda en character_activity y deja de retener su
-- snapshot (ADR 0053).
--
-- El archivado conservaba en Postgres, para siempre, la fila de rating más alto
-- de cada serie: `readPeakRating` es el máximo de la temporada entera y no tenía
-- otra forma de leerlo. Era una fila de snapshot completa —con sus índices— para
-- guardar un entero, y una más por cada jugador que bajaba de su pico.
--
-- Pasa a ser lo mismo que archived_observations: lo mueve el archivado, en la
-- misma transacción que borra las filas, como el máximo de lo que saca. El pico
-- de la serie entera es el mayor entre esto y lo que sigue caliente.
--
-- Nullable y sin default: añadir la columna no reescribe la tabla. null es «no
-- se ha archivado ninguna fila desde esta migración», y es exacto sin rellenar
-- nada: hasta hoy el pico nunca se archivaba, así que todo lo archivado antes
-- está por debajo de un pico que sigue en character_snapshots, y saldrá por
-- aquí cuando el archivado lo saque.
alter table character_activity
  add column if not exists archived_peak_rating int;

comment on column character_activity.archived_peak_rating is
  'Rating más alto entre los snapshots de esta serie que ya se archivaron (ADR 0053). '
  'El pico de la temporada es el mayor entre esto y el máximo de lo que sigue en '
  'character_snapshots. null si no se ha archivado nada desde la migración 0031.';
