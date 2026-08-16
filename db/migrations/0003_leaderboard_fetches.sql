-- Bitácora de descargas del leaderboard.
--
-- Nace de convertir el fetch manual en job programado (§28 del plan). Resuelve
-- dos problemas que solo aparecen cuando el job corre solo cada pocas horas:
--
-- 1) Blizzard publica el leaderboard cada ~3h, pero nosotros preguntamos en
--    nuestro propio reloj. Sin memoria de lo ya visto, cada corrida insertaría
--    otro juego completo de snapshots con un captured_at distinto y contenido
--    idéntico: el histórico —el moat del producto— se llenaría de repeticiones
--    que parecen medidas nuevas. Guardando el hash del contenido sabemos si la
--    fuente cambió de verdad y solo entonces se ingiere.
--
-- 2) La cadencia real de publicación sigue siendo una asunción de terceros
--    ("~3h aprox., a confirmar" en §28). Cada fila es una observación fechada;
--    los intervalos entre filas con changed = true la miden en vez de suponerla.
--
-- Esta tabla es observación del pipeline, no población: no la consulta el
-- producto ni entra en ningún tamaño de muestra.
create table if not exists leaderboard_fetches (
  id                 bigserial primary key,
  region             text        not null,
  season_id          int         not null,
  bracket            text        not null,          -- p.ej. 'shuffle-mage-frost'
  fetched_at         timestamptz not null,          -- nuestro reloj, no el de Blizzard
  -- null solo si la descarga falló: "no se pudo mirar" es distinto de "se miró y no cambió".
  content_hash       text,
  entry_count        int         not null default 0,
  -- ¿difiere del content_hash anterior de este bracket? La primera observación
  -- de un bracket cuenta como cambio: no hay nada previo con lo que comparar.
  changed            boolean     not null,
  ingested_snapshots int         not null default 0,
  note               text                            -- aviso de la API, si lo hubo
);

-- La query caliente es "última observación de este bracket" (para comparar el
-- hash) y "todas las de este bracket en orden" (para medir la cadencia).
create index if not exists idx_leaderboard_fetches_bracket
  on leaderboard_fetches (region, bracket, fetched_at desc);
