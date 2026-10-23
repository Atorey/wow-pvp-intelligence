-- La última observación de leaderboard de cada serie vive también en
-- character_presence, y las lecturas la ven a través de una vista (ADR 0054).
--
-- El archivado conserva fuera de la ventana caliente el ancla de cada origen:
-- la última fila anterior al corte. En leaderboard eso es una fila de
-- character_snapshots, con sus tres índices, por cada una de las 138.182 series,
-- el 23 de octubre de 2026 unos 135.000 snapshots y ~50 MB, solo para que la
-- ingesta por cambio, el recálculo de actividad, los agregados y la ficha sigan
-- viendo la última observación de quien lleva días sin cambiar.
--
-- character_presence ya tiene una fila por serie y la ingesta la toca en cada
-- publicación. Aquí gana una copia exacta de la fila ancla —mismos valores y
-- mismo captured_at, en changed_at—, y la vista character_observations la
-- devuelve como una fila más de leaderboard cuando ya no está en
-- character_snapshots. Mientras el ancla siga en la tabla, la vista no añade
-- nada: esta migración no cambia ninguna lectura. Soltar el ancla es el paso
-- siguiente, en archive-snapshots, y solo cuando la presencia apunte justo a
-- ella.

-- 1) La fila ancla, por columnas. Nullable y sin default: no reescribe la
--    tabla. null en changed_at es «sin ancla copiada todavía».
alter table character_presence
  add column if not exists changed_at     timestamptz,
  add column if not exists class_slug     text,
  add column if not exists spec_slug      text,
  add column if not exists rating         int,
  add column if not exists ladder_rank    int,
  add column if not exists matches_played int,
  add column if not exists matches_won    int,
  add column if not exists matches_lost   int,
  add column if not exists pvp_tier_id    int;

comment on column character_presence.changed_at is
  'captured_at del último snapshot de leaderboard de la serie, que esta fila copia '
  'en rating, ladder_rank, partidas y tier (ADR 0054). No es last_seen_at: es cuándo '
  'cambió por última vez, no cuándo se le vio. null si aún no se ha copiado.';

-- 2) Relleno desde el ancla de hoy, que sigue entera en character_snapshots.
--    Reescribe una vez las ~138.000 filas: el hueco lo reutilizan las
--    actualizaciones de cada publicación, y si no, lo devuelve un compact.
update character_presence p
   set changed_at     = l.captured_at,
       class_slug     = l.class_slug,
       spec_slug      = l.spec_slug,
       rating         = l.rating,
       ladder_rank    = l.ladder_rank,
       matches_played = l.matches_played,
       matches_won    = l.matches_won,
       matches_lost   = l.matches_lost,
       pvp_tier_id    = l.pvp_tier_id
  from (
    select distinct on (character_id, bracket, season_id)
           character_id, bracket, season_id, captured_at, class_slug, spec_slug,
           rating, ladder_rank, matches_played, matches_won, matches_lost, pvp_tier_id
      from character_snapshots
     where source = 'leaderboard'
     order by character_id, bracket, season_id, captured_at desc
  ) l
 where l.character_id = p.character_id
   and l.bracket = p.bracket
   and l.season_id = p.season_id;

-- 3) Las observaciones: character_snapshots más el ancla de leaderboard que ya
--    no está en él. El not exists va por el índice único de captura, y es lo que
--    impide contar dos veces la misma observación mientras siga en la tabla.
create or replace view character_observations as
select s.id, s.character_id, s.captured_at, s.source, s.season_id, s.bracket,
       s.class_slug, s.spec_slug, s.rating, s.ladder_rank,
       s.matches_played, s.matches_won, s.matches_lost, s.pvp_tier_id,
       s.average_item_level, s.equipped_item_level, s.talent_loadout_code,
       s.hero_talent_tree_id, s.hero_talent_tree_name,
       false as from_presence
  from character_snapshots s
union all
select null::bigint, p.character_id, p.changed_at, 'leaderboard', p.season_id, p.bracket,
       p.class_slug, p.spec_slug, p.rating, p.ladder_rank,
       p.matches_played, p.matches_won, p.matches_lost, p.pvp_tier_id,
       null::int, null::int, null::text,
       null::int, null::text,
       true
  from character_presence p
 where p.changed_at is not null
   and not exists (
         select 1 from character_snapshots s
          where s.character_id = p.character_id
            and s.bracket = p.bracket
            and s.captured_at = p.changed_at);

comment on view character_observations is
  'character_snapshots más el ancla de leaderboard que solo queda en character_presence '
  '(ADR 0054). Es lo que lee quien busca la última observación de una serie: la tabla '
  'sola pierde a quien lleva más de 3 días sin cambiar. from_presence marca la fila '
  'que no es un snapshot, sin id y ya contada en archived_observations.';

-- 4) La vista de la 0001 pasa a leer de las observaciones, con las mismas
--    columnas: la siguen usando el buscador y el muestreo de perfiles.
create or replace view latest_snapshot_per_character_bracket as
select distinct on (character_id, bracket)
  character_id, bracket, season_id, class_slug, spec_slug, rating, ladder_rank, captured_at
from character_observations
order by character_id, bracket, captured_at desc;
