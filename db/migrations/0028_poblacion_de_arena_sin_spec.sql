-- Cuánta población de arena no tiene spec conocida (ADR 0048, punto 6).
--
-- En 2v2 y 3v3 un personaje cuenta en la spec de su perfil más reciente dentro
-- de la ventana de agregación. Quien no tiene perfil en la ventana sí está en el
-- tramo, pero no en ninguna spec, y una población que solo existe para quien
-- tiene perfil tiene que decir cuánta queda fuera: sin este número, «12 Frost
-- Mage en 3v3 2000-2200» se leería como si fueran todos los que hay.
--
-- Es una cifra del (bracket, tramo) y no de la spec, así que va igual en todas
-- las filas de spec de ese tramo en la corrida, como `leaderboard_entries` va
-- igual en todas las de un bracket (migración 0026). Se cuenta con la ventana más
-- ancha de la corrida, igual que `excluded_search`.
--
-- Nullable y sin default: añadir la columna no reescribe la tabla. null en Solo
-- Shuffle, donde la spec la nombra el bracket y la pregunta no existe, y en las
-- filas anteriores a esta migración. Cero en arena es "todos tienen spec".
alter table population_segments
  add column if not exists without_spec int;

comment on column population_segments.without_spec is
  'Activos del mismo bracket y tramo sin spec conocida: arena sin perfil en la '
  'ventana de agregación (ADR 0048). Igual en todas las filas de spec del tramo '
  'en la corrida. null en Solo Shuffle y en filas anteriores a la migración 0028.';
