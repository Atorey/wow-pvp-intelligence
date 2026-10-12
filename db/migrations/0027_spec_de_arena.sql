-- 2v2 y 3v3: la spec sale del perfil, y lo que no tiene perfil no tiene spec
-- (ADR 0048).
--
-- Hasta aquí el bracket nombraba la spec ('shuffle-mage-frost'), y por eso
-- class_slug y spec_slug eran not null y ninguna clave de los agregados los
-- llevaba. En arena no es así: el leaderboard de '2v2' y '3v3' es uno para todas
-- las specs y ninguna de sus entradas trae clase ni spec, y el pvp-bracket del
-- personaje tampoco. La única fuente es el active_spec del perfil.
--
-- Esta migración no reescribe filas. Quitar un not null y añadir un check
-- `not valid` es solo catálogo. Las claves únicas nuevas construyen un índice
-- sobre population_segments y segment_coverage, que tienen decenas de miles de
-- filas. Lo pesado de 0022 (reescribir una tabla grande) no se repite aquí.

-- 1) La observación de arena sin perfil no tiene clase ni spec.
--
--    null es "no disponible" (regla 5), no una spec por defecto. Rellenarla con
--    la spec de Solo Shuffle del mismo personaje acertaría a menudo y fallaría
--    justo con quien juega otra spec en arena, sin que se notase en el agregado.
alter table character_snapshots
  alter column class_slug drop not null,
  alter column spec_slug  drop not null;

--    El null solo se admite donde no hay forma de saberla: una fila de
--    leaderboard de un bracket que no nombra spec. Una fila de Solo Shuffle sin
--    spec, o un perfil sin ella, siguen siendo un error. Una modalidad nueva sin
--    spec (RBG) entra cambiando este check, que es una decisión y no un descuido.
--
--    `not valid` aplica el check a cada fila nueva sin recorrer las que hay, que
--    lo cumplen igualmente: hasta esta migración las dos columnas eran not null.
alter table character_snapshots
  drop constraint if exists character_snapshots_spec_known_check;

alter table character_snapshots
  add constraint character_snapshots_spec_known_check
  check (
    (class_slug is null) = (spec_slug is null)
    and (spec_slug is not null or (source = 'leaderboard' and bracket in ('2v2', '3v3')))
  ) not valid;

comment on column character_snapshots.class_slug is
  'Clase de la observación. En Solo Shuffle se deduce del bracket; en 2v2/3v3 '
  'es la del perfil de esa captura. null solo en filas de leaderboard de arena, '
  'que no la traen (ADR 0048).';

comment on column character_snapshots.spec_slug is
  'Spec de la observación. En Solo Shuffle se deduce del bracket; en 2v2/3v3 es '
  'el active_spec del perfil de esa captura, no la spec de otro bracket. null '
  'solo en filas de leaderboard de arena, que no la traen (ADR 0048).';

-- 2) Un segmento es (bracket, clase, spec, tramo).
--
--    Con '3v3' en el bracket, Frost Mage y Holy Paladin del mismo tramo y la
--    misma corrida chocarían en la clave de antes. La clase entra porque el
--    slug de spec no es único entre clases: 'frost' es de mago y de caballero
--    de la muerte. En Solo Shuffle la clave nueva identifica exactamente lo
--    mismo que la vieja, porque el bracket ya fijaba la spec.
--
--    Las restricciones de antes tienen el nombre que les puso Postgres, truncado
--    a 63 caracteres, así que se buscan en el catálogo en vez de adivinarlo. Las
--    nuevas llevan nombre propio para que la próxima migración no tenga que
--    buscarlas.
do $$
declare
  target record;
begin
  for target in
    select conrelid::regclass as tbl, conname
      from pg_constraint
     where contype = 'u'
       and conrelid in ('population_segments'::regclass, 'segment_coverage'::regclass)
  loop
    execute format('alter table %s drop constraint %I', target.tbl, target.conname);
  end loop;
end $$;

alter table population_segments
  add constraint population_segments_run_key
  unique (region, season_id, bracket, class_slug, spec_slug, segment_id, computed_at);

alter table segment_coverage
  add constraint segment_coverage_run_key
  unique (region, season_id, bracket, class_slug, spec_slug, subject_segment_id, computed_at);
