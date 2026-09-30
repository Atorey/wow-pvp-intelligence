-- Cuántas entradas publicaba el leaderboard de cada bracket cuando se calculó la
-- corrida (ADR 0045).
--
-- El leaderboard publica como mucho 5.000 entradas por bracket. En una temporada
-- madura ese tope corta la cola de las specs más jugadas: de una spec popular
-- vemos la parte alta entera y de una poco jugada, todo. Mientras ninguna lo
-- toque, la población de dos specs se puede comparar; en cuanto una lo toca, su
-- población deja de ser una medida para ser un suelo, y el reparto de la
-- modalidad lo tiene que declarar.
--
-- El dato ya existía en `leaderboard_fetches.entry_count`, pero aquella tabla es
-- observación del pipeline y no la consulta el producto (migración 0003). Se
-- copia a la corrida por dos razones:
--
--   1) Una sola fecha. Lo que la web declara tiene que ser lo que vio la corrida
--      cuya población enseña, no la publicación que llegó tres horas después.
--   2) Ninguna consulta nueva. `/meta` y la portada leen la población de una
--      sola consulta sobre esta tabla (ADR 0038, decisión 9), y la cifra entra
--      en ella.
--
-- Se guarda el número y no un booleano «recortada», por lo mismo que la
-- migración 0018 quitó `confidence`: el juicio se deriva al leer con
-- `isLeaderboardCapped()`, y una fila vieja no puede contradecir a la función
-- que lo define.
--
-- Nullable y sin default: añadir la columna no reescribe la tabla, y las filas
-- de antes de esta migración no saben cuántas entradas había. Suponer cero, o
-- suponer el tope, sería fabricar el dato (regla 5).
alter table population_segments
  add column if not exists leaderboard_entries int;

comment on column population_segments.leaderboard_entries is
  'Entradas de la última publicación del leaderboard de este bracket que se '
  'descargó bien antes de la corrida. Igual en todas las filas del bracket de '
  'una corrida. null = no se sabe: filas anteriores a la migración 0026, o un '
  'bracket sin ninguna descarga buena en la temporada. Si llena el tope '
  '(isLeaderboardCapped), la población del bracket es un suelo (ADR 0045).';
