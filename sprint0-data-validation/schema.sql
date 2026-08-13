-- Sprint 0 — schema mínimo (días 5-7 del plan).
-- Cubre solo lo necesario para ingerir el dataset de leaderboard y calcular
-- la primera distribución de rating por segmento (sección 27 del plan de
-- producto). Build/Gear/Talentos se añaden más adelante, cuando empecemos a
-- traer perfiles completos (no solo entradas de leaderboard) a escala.
--
-- Principio de diseño (sección 27, no negociable): character_snapshots es
-- append-only. Nunca hacemos UPDATE de rating sobre una fila existente —
-- cada recogida de datos inserta una fila nueva. El "estado actual" de un
-- personaje es, por definición, su snapshot más reciente.

create extension if not exists "uuid-ossp";

create table if not exists characters (
  id                    uuid primary key default uuid_generate_v4(),
  region                text not null,              -- 'eu' | 'us' | ...
  realm_slug            text not null,
  name_slug             text not null,               -- nombre en minúsculas, sin acentos si aplica
  name_display          text not null,               -- nombre tal cual viene de la API (para mostrar)
  faction               text,                        -- 'ALLIANCE' | 'HORDE' | null si no viene
  blizzard_character_id bigint,                       -- character.id de la API — más estable que
                                                        -- nombre+reino si hay cambio de nombre/transfer
  first_seen_at         timestamptz not null default now(),
  unique (region, realm_slug, name_slug)
);

create unique index if not exists idx_characters_blizzard_id
  on characters (region, blizzard_character_id)
  where blizzard_character_id is not null;

create table if not exists character_snapshots (
  id            bigserial primary key,
  character_id  uuid not null references characters(id) on delete cascade,
  captured_at   timestamptz not null default now(),
  source        text not null check (source in ('leaderboard', 'profile')),
  season_id     int not null,
  bracket       text not null,               -- p.ej. 'shuffle-mage-frost'
  class_slug    text not null,               -- deducido del bracket, no de un campo de la API
  spec_slug     text not null,               -- idem
  rating        int not null,
  ladder_rank   int,                          -- posición en el leaderboard (character.rank)
  matches_played int,                        -- season_match_statistics.played, gratis desde leaderboard
  matches_won    int,
  matches_lost   int,
  pvp_tier_id    int                         -- tier.id, gratis desde leaderboard; referencia a pvp-tier
);

-- Índices para las queries que vamos a hacer todo el rato: última rating por
-- personaje, y distribución de rating por bracket+temporada.
create index if not exists idx_snapshots_character on character_snapshots (character_id, captured_at desc);
create index if not exists idx_snapshots_bracket_season on character_snapshots (bracket, season_id, rating);

-- Vista de conveniencia: snapshot más reciente por personaje y bracket.
-- Esto es lo que alimenta el cálculo de PopulationSegment / AggregateSnapshot
-- de la sección 27 — nunca se consulta character_snapshots "a pelo" para
-- construir la distribución actual, siempre a través de esta vista (o su
-- equivalente filtrado por ventana de actividad, sección 27 "Active Players",
-- que en Sprint 0 todavía no aplicamos porque solo tenemos un snapshot por
-- personaje).
create or replace view latest_snapshot_per_character_bracket as
select distinct on (character_id, bracket)
  character_id, bracket, season_id, class_slug, spec_slug, rating, ladder_rank, captured_at
from character_snapshots
order by character_id, bracket, captured_at desc;
