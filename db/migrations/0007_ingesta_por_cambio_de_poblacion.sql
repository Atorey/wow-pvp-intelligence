-- Ingesta por cambio de población, no por cambio de payload (#53, ADR 0009).
--
-- El ADR 0004 decidió ingerir solo cuando el hash del payload de Blizzard
-- difiere del anterior. La medición sobre las temporadas 41 y 42 en EU dice que
-- ese hash se mueve por cosas que no son población: de las 148 transiciones
-- entre publicaciones consecutivas de la temporada 41, 36 movían solo el `rank`,
-- 49 eran altas o bajas de la lista y 96 no cambiaban NADA de lo que
-- guardamos — ni rating, ni partidas, ni tier, ni siquiera el rank. Aun así se
-- ingirieron: 447.851 snapshots en un solo día, ninguno con información nueva.
--
-- Y en temporada viva el problema no lo arregla un hash mejor: en la 42, 246 de
-- 303 publicaciones traen algún cambio real, pero solo el 18% de las filas de
-- cada una lo lleva. El resto entra porque *otro* jugador del bracket jugó.
--
-- De ahí las dos piezas de esta migración: una huella de población que decide si
-- se ingiere el bracket, y una tabla de presencia que sostiene lo que el filtro
-- por fila deja de poder derivarse de character_snapshots.

-- 1) Bitácora: separar "Blizzard publicó" de "la población cambió".
--
--    Eran lo mismo mientras el hash del payload decidía la ingesta, y por eso
--    `changed` servía para las dos cosas. Ya no: la cadencia de publicación
--    (para la que nació la bitácora, ADR 0004) se mide con `published`, y
--    `changed` pasa a significar "la población cambió, así que se ingirió".
alter table leaderboard_fetches
  -- Huella de lo que de verdad guardamos: identidad, rating, partidas y tier,
  -- ordenada por identidad. Null = no disponible (regla 5): la descarga falló, o
  -- la ingesta falló y no queremos que la corrida siguiente dé el bracket por
  -- ingerido, o es una fila anterior a esta migración.
  add column if not exists population_hash   text,
  -- ¿El payload crudo difiere del anterior? Es la observación de publicación.
  add column if not exists published         boolean,
  -- Entradas recibidas que no se insertaron por ser idénticas a la última
  -- observación de leaderboard del mismo personaje. Es el número que #48
  -- necesita para decidir retención: cuánto de lo que llega es repetición.
  add column if not exists redundant_entries int not null default 0;

-- Las filas antiguas sí pueden decir si hubo publicación: hasta ahora `changed`
-- se calculaba exactamente así, comparando el hash del payload crudo. No se
-- inventa nada, se traslada. `population_hash` se queda null: de aquellas
-- descargas no se guardó, y suponerlo sería fabricar dato.
update leaderboard_fetches set published = changed where published is null;

-- 2) Presencia: "le hemos visto en la lista", separado de "ha jugado".
--
--    Con el filtro por fila, character_snapshots pasa de ser toda observación a
--    ser todo cambio, y `last_seen_at` deja de poder derivarse de ahí. Ese proxy
--    no es decorativo: el ADR 0008 lo conserva para medir con dato delante la
--    distancia entre "le hemos visto" y "ha jugado", que es justo el sesgo que
--    #16 vino a quitar. Aquí vive ahora, a una fila por personaje y temporada en
--    vez de una por publicación.
--
--    Tabla DERIVADA, como character_activity: admite update sin romper el ADR
--    0002, que protege las observaciones y no los contadores sobre ellas.
create table if not exists character_presence (
  character_id  uuid        not null references characters(id) on delete cascade,
  bracket       text        not null,
  -- Por temporada: la lista se vacía con ella, y "sigue en el ladder" no
  -- significa lo mismo a un lado y otro del corte.
  season_id     int         not null,
  first_seen_at timestamptz not null,
  last_seen_at  timestamptz not null,
  -- En cuántas publicaciones distintas le hemos visto en la lista. Con el filtro
  -- por fila, `character_activity.observations` cuenta cambios, no vistas: son
  -- dos números distintos y a partir de ahora se guardan por separado.
  publications  int         not null default 1,
  primary key (character_id, bracket, season_id)
);

-- La query caliente es "presencia de los personajes de este bracket", que es
-- como la lee el recálculo de actividad.
create index if not exists idx_character_presence_bracket
  on character_presence (season_id, bracket);

-- 3) Arranque de la presencia con lo que ya está ingerido.
--
--    Se reconstruye desde character_snapshots porque hasta hoy cada publicación
--    dejaba una fila por personaje: mientras el histórico sea el de antes de
--    #53, "vistas" y "filas" coinciden. Desde la primera ingesta con filtro
--    dejan de coincidir, y por eso esto es un arranque y no un recálculo
--    repetible.
insert into character_presence
  (character_id, bracket, season_id, first_seen_at, last_seen_at, publications)
select character_id, bracket, season_id,
       min(captured_at), max(captured_at), count(distinct captured_at)
  from character_snapshots
 where source = 'leaderboard'
 group by character_id, bracket, season_id
on conflict (character_id, bracket, season_id) do nothing;
