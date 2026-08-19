-- Ventana de actividad real: last_active_snapshot_date (§27 del plan, #16).
--
-- §27 exige que todo cálculo de AggregateSnapshot filtre por
-- `last_active_snapshot_date`, y hasta ahora el filtro era un proxy declarado
-- como tal en el ADR 0007: "lo hemos vuelto a ver en el ladder". No es lo
-- mismo. Aparecer en el leaderboard no es haber jugado — quien está dentro del
-- top 5.000 sigue saliendo en cada publicación aunque lleve semanas parado —, y
-- el proxy sobreestima justo el tramo alto, que es el que nunca cae de la lista.
--
-- La API no da "last seen" (§30). Lo único que se mueve cuando alguien juega es
-- `season_match_statistics.played`, así que la actividad se deriva de la
-- variación de ese contador entre snapshots nuestros. La regla vive en
-- packages/core (activity.ts) y aquí solo se materializa su resultado.
--
-- Esta tabla es DERIVADA, como population_segments: se reconstruye entera desde
-- character_snapshots ejecutando `refresh-activity`. Por eso admite update —el
-- append-only del ADR 0002 protege las observaciones, no los cálculos sobre
-- ellas— y por eso una fila de aquí puede borrarse sin perder nada
-- irrecuperable.

create table if not exists character_activity (
  character_id   uuid        not null references characters(id) on delete cascade,
  bracket        text        not null,          -- p.ej. 'shuffle-mage-frost'
  -- La actividad es por temporada: el contador de partidas se reinicia con
  -- ella, así que una serie que cruce el corte no es comparable consigo misma.
  season_id      int         not null,
  -- `last_active_snapshot_date` de §27: la fecha por la que se filtra.
  last_active_at timestamptz not null,
  -- De qué está hecha esa fecha, porque las dos no valen lo mismo:
  --   'played-delta' le hemos visto subir el contador entre dos observaciones:
  --                  sabemos que jugó y cuándo.
  --   'first-seen'   nunca le hemos visto subirlo. Lo único demostrable es que
  --                  jugó en algún momento anterior a nuestra primera
  --                  observación (para estar en el ladder hay que jugar), así
  --                  que se fecha ahí: es la cota más antigua defendible y
  --                  caduca sola. Sin este valor, un agregado no podría decir
  --                  qué parte de su población es evidencia y qué parte es
  --                  arranque, y con el histórico que tenemos hoy —días, no
  --                  meses— casi toda es arranque.
  evidence       text        not null check (evidence in ('played-delta', 'first-seen')),
  -- Último contador conocido. null = no disponible (regla 5), no "cero partidas".
  last_played    int,
  -- Cuántas observaciones sostienen la fila: con 1 nunca puede haber delta.
  observations   int         not null,
  first_seen_at  timestamptz not null,
  -- El proxy anterior a #16. Se conserva para poder medir la distancia entre
  -- "le hemos visto" y "ha jugado" con dato delante, en vez de suponerla.
  last_seen_at   timestamptz not null,
  computed_at    timestamptz not null,
  primary key (character_id, bracket, season_id)
);

-- La query caliente es "quién está activo en este bracket dentro de la ventana".
create index if not exists idx_character_activity_window
  on character_activity (season_id, bracket, last_active_at desc);

-- Qué parte de la población de un segmento entró por evidencia y qué parte por
-- arranque. Va en la fila del agregado, junto a sample_size y a la ventana,
-- porque es parte de la definición del número: un n=120 hecho de 118
-- 'first-seen' no promete lo mismo que uno hecho de 118 'played-delta', y con
-- pocos días de histórico el primero es el caso normal, no la excepción.
alter table population_segments
  add column if not exists active_by_delta      int not null default 0,
  add column if not exists active_by_first_seen int not null default 0;
