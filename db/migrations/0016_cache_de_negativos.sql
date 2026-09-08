-- Caché de "este personaje no existe" (ADR 0030).
--
-- Un 404 de Blizzard no dejaba rastro que se pudiera leer: no crea identidad, y
-- character_lookups era una bitácora en la que solo se escribía. Así que
-- preguntar cien veces por un nombre inventado costaba cien peticiones a una
-- cuota que se comparte con el pipeline, y enumerar un diccionario de nombres
-- salía tan barato como teclearlo.
--
-- La bitácora ya tiene lo que hace falta —el índice por (region, realm_slug,
-- name_slug, requested_at desc)—, así que la caché es una lectura y no una tabla
-- nueva. Lo único que le falta es poder distinguir el 404 que costó una petición
-- del que se respondió de memoria.
--
-- Sin ese valor aparte, la caché se autoalimentaría: cada acierto escribiría una
-- fila 'not-found' con fecha fresca, y alguien preguntando una vez por minuto
-- mantendría a ese personaje invisible para siempre. Y contaminaría la métrica
-- que justifica la acumulación por búsqueda con filas que no costaron nada.
alter table character_lookups drop constraint if exists character_lookups_outcome_check;

alter table character_lookups
  add constraint character_lookups_outcome_check
  check (outcome in ('ok', 'cached', 'not-found', 'not-found-cached', 'no-brackets', 'error'));

comment on column character_lookups.outcome is
  'Cómo acabó la búsqueda. La caché de negativos solo mira las filas ''not-found'': las '
  '''not-found-cached'' son aciertos que no costaron petición, y contarlas alargaría la ventana.';
