-- Clave de búsqueda plegada para los nombres de personaje (#70, ADR 0017).
--
-- No cambia la identidad: (region, realm_slug, name_slug) sigue siendo la
-- misma, con los acentos intactos y tal como responde Blizzard. Lo que se añade
-- es la clave con la que se *busca*, que es otra cosa y no puede ser única —
-- en la población acumulada hay 1.626 grupos de personajes distintos del mismo
-- reino cuyos nombres solo se diferencian en los acentos.
--
-- Se rellena desde el pipeline (`npm run pipeline -- backfill-name-fold`) y no
-- aquí, y tampoco es una columna generada: la regla de plegado vive en
-- foldSlug() de packages/core, y escribirla otra vez en SQL crearía dos
-- verdades que divergirían a la primera letra que se añadiera a la tabla de
-- equivalencias. Por eso nace nullable — null es "todavía sin plegar".

alter table characters add column if not exists name_fold text;

create index if not exists idx_characters_name_fold
  on characters (region, realm_slug, name_fold);

comment on column characters.name_slug is
  'Nombre en minúsculas, con los diacríticos intactos: la forma canónica de Blizzard. '
  'Es identidad y es URL. Plegarla fundiría personajes distintos (ADR 0017).';

comment on column characters.name_fold is
  'name_slug sin diacríticos, solo para buscar. No es única y no se publica en ninguna ruta. '
  'La calcula foldSlug() de packages/core; ningún proceso la escribe en SQL.';
