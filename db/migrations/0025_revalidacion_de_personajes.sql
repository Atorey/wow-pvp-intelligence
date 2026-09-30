-- Revalidación de 30 días y borrado del personaje que ya no existe (ADR 0043).
--
-- La cláusula 2.s de la ToU de Blizzard obliga a no guardar nada más de 30 días
-- sin revalidarlo, y para WoW deja revalidar comprobando que el personaje sigue
-- existiendo (ADR 0015, decisión 2). Hasta aquí no había ni el registro de esa
-- comprobación ni el borrado de quien deja de existir.
--
-- Medido el 30 de septiembre de 2026: de 172.110 personajes, unos 79.000
-- llevaban más de 30 días sin ninguna prueba de existencia, casi todos de la
-- temporada 41.

-- 1) La última prueba de que el personaje existe en Blizzard.
--
--    No se deriva al leer porque ya no se puede: desde el ADR 0042 la presencia
--    y los snapshots de una temporada cerrada no están en Postgres, y de quien
--    solo jugó esa temporada no queda más que su fila aquí. La mueven todas las
--    fuentes que acaban de oír a Blizzard hablar de él: la ingesta del
--    leaderboard, la de perfiles, la búsqueda y el barrido de revalidación.
alter table characters add column if not exists verified_at timestamptz;

--    El arranque, con lo que todavía está en Postgres. `first_seen_at` es la
--    prueba de que llegó de Blizzard; lo demás, pruebas posteriores. Lo que se
--    archivó de la temporada 41 ya no cuenta, y es lo correcto: esos personajes
--    llevan de verdad más de 30 días sin que nadie los mire.
update characters c
   set verified_at = greatest(c.first_seen_at, p.last, s.last, l.last)
  from characters base
  left join (select character_id, max(last_seen_at) as last
               from character_presence group by character_id) p
    on p.character_id = base.id
  left join (select character_id, max(captured_at) as last
               from character_snapshots group by character_id) s
    on s.character_id = base.id
  left join (select region, realm_slug, name_slug, max(requested_at) as last
               from character_lookups
              where outcome in ('ok', 'no-brackets')
              group by region, realm_slug, name_slug) l
    on l.region = base.region and l.realm_slug = base.realm_slug and l.name_slug = base.name_slug
 where base.id = c.id
   and c.verified_at is null;

--    Un personaje solo entra en esta tabla porque una fuente acaba de traerlo de
--    Blizzard, así que el alta es en sí misma una prueba.
alter table characters alter column verified_at set default now();
alter table characters alter column verified_at set not null;

--    Sin índice a propósito: la leen el barrido y el vigilante una vez al día, y
--    una tabla de 170.000 filas se recorre entera en nada. Un índice sobre una
--    columna que la ingesta mueve en cada publicación rompería además las
--    actualizaciones HOT de la tabla que más se reescribe.

-- 2) El primer 404 del barrido, pendiente de confirmar.
--
--    Un 404 aislado no borra: una caída de Blizzard que devolviera 404 durante
--    un barrido se llevaría por delante a miles de personajes sin vuelta atrás.
--    Se anota y se confirma en una corrida posterior; cualquier prueba de
--    existencia entre medias lo vuelve a null.
alter table characters add column if not exists missing_since timestamptz;

-- 3) Los personajes borrados, para que el borrado alcance también a Storage.
--
--    El `on delete cascade` desde `characters` limpia Postgres en la misma
--    transacción, pero lo archivado de ese personaje sigue en los lotes de
--    Storage y en el índice de rating (ADR 0034, ADR 0039), y reescribirlos es
--    caro: se hace en bloque con `purge-archive`. Esta tabla es la cola de ese
--    trabajo y su bitácora.
--
--    Solo guarda el id interno: es lo único con lo que se encuentra al personaje
--    en el archivo, y sin su fila en `characters` ya no apunta a ningún nombre.
create table if not exists character_erasures (
  character_id     uuid        primary key,
  erased_at        timestamptz not null default now(),
  -- La última prueba de existencia que tenía. El plazo de 30 días de la ToU
  -- corre desde aquí, no desde el borrado: es lo que vigila check-freshness.
  last_verified_at timestamptz not null,
  -- 'not-found'  dos 404 del endpoint de estado, separados en el tiempo
  -- 'invalid'    el endpoint de estado dice is_valid = false
  -- 'id-changed' el nombre existe, pero es de otro personaje (otro id de Blizzard)
  reason           text        not null
    check (reason in ('not-found', 'invalid', 'id-changed')),
  -- null mientras sus filas sigan en Storage.
  purged_at        timestamptz
);

comment on table character_erasures is
  'Personajes borrados porque ya no existen en Blizzard (ADR 0043). Solo el id interno: '
  'es la cola de purge-archive, que los quita de los lotes y del índice de Storage.';

-- 4) Objetos de Storage que sobran y hay que borrar.
--
--    El archivo no se sobrescribe nunca (`x-upsert: false`, ADR 0034): una purga
--    escribe el lote filtrado en una ruta nueva y deja la vieja aquí. Y quien va
--    a subir anota antes la ruta, y la desanota en la misma transacción que la
--    apunta desde la bitácora: si algo se corta entre medias, lo subido a medias
--    queda anotado en vez de huérfano, y la siguiente corrida lo borra.
create table if not exists archive_garbage (
  object_path text        primary key,
  noted_at    timestamptz not null default now()
);

comment on table archive_garbage is
  'Rutas del bucket del archivo que ninguna bitácora apunta y hay que borrar (ADR 0043). '
  'Una ruta aquí nunca la lee nadie.';
