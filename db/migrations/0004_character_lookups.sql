-- Acumulación de población por búsqueda de usuario (§6 y §12 del plan).
--
-- El leaderboard tiene un techo de 5.000 por spec, y ese techo no cae donde
-- haría falta: en las specs más jugadas el corte se queda por encima del ICP
-- (Frost Mage no baja de ~1800). La segunda capa de población de §12 —"todo
-- personaje que alguien consultó"— es la única que puede cubrir 1400-1800, y
-- solo se llena si cada búsqueda deja rastro en la base de datos.

-- 1) Procedencia del snapshot.
--
--    Un personaje que entra porque alguien lo buscó NO es una muestra
--    equivalente a una del leaderboard ni a una del muestreo por segmento: entra
--    porque alguien se interesó por él, que es un sesgo de selección real y
--    reconocido en el propio plan ("solo entran personajes que alguien buscó").
--    Mezclarlo bajo 'profile' lo haría indistinguible para siempre en el
--    histórico, y con él la capa 2 de §12 dejaría de poder medirse o excluirse.
--    Marcarlo cuesta un valor más en el check; no marcarlo no tiene vuelta atrás.
alter table character_snapshots drop constraint if exists character_snapshots_source_check;

alter table character_snapshots
  add constraint character_snapshots_source_check
  check (source in ('leaderboard', 'profile', 'search'));

-- 2) Bitácora de búsquedas.
--
--    Misma idea que leaderboard_fetches: observación del pipeline, no población.
--    No la consulta el producto ni entra en ningún tamaño de muestra.
--
--    Existe porque §12 declara la acumulación por búsqueda "necesaria, no
--    opcional" y eso es una hipótesis, no un hecho medido. Cada fila dice si la
--    búsqueda trajo un personaje que no teníamos, si se sirvió de caché o si no
--    existía; el agregado responde a "¿cuánta población nueva aporta de verdad
--    la búsqueda?", que hoy no se puede responder con nada de lo que guardamos.
create table if not exists character_lookups (
  id                 bigserial primary key,
  region             text        not null,
  realm_slug         text        not null,
  name_slug          text        not null,
  requested_at       timestamptz not null,
  -- 'ok'          se consultó a Blizzard y se ingirió
  -- 'cached'      dentro del TTL: no se llamó a Blizzard (§28, caché corta)
  -- 'not-found'   Blizzard dice que ese personaje no existe (404)
  -- 'no-brackets' el personaje existe pero no juega ningún Solo Shuffle
  -- 'error'       fallo de API: "no se pudo mirar", distinto de "no existe"
  outcome            text        not null
    check (outcome in ('ok', 'cached', 'not-found', 'no-brackets', 'error')),
  -- null cuando la búsqueda no llegó a identidad: 404 o error de API.
  character_id       uuid references characters(id) on delete set null,
  -- ¿lo teníamos ya? Es la métrica que justifica (o no) toda la feature.
  new_character      boolean     not null default false,
  brackets_found     int         not null default 0,
  snapshots_inserted int         not null default 0,
  note               text
);

-- La query caliente es "qué se ha buscado últimamente", tanto para medir el
-- aporte como para detectar a mano un patrón de abuso sobre el mismo personaje.
create index if not exists idx_character_lookups_requested
  on character_lookups (requested_at desc);

create index if not exists idx_character_lookups_target
  on character_lookups (region, realm_slug, name_slug, requested_at desc);
