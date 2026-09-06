-- La medición de la North Star, emitida por la propia caja Player Gap (§35 del
-- plan, ADR 0028).
--
-- La métrica no son pageviews: es "Player Gap views con confianza High o Medium
-- por usuario único activo semanal", y su gemela de salud del dato es el "% de
-- views con confianza Low". Las dos salen de esta tabla, y por eso la fila se
-- escribe también cuando **no** hubo comparación: sin denominador no hay
-- cociente.
--
-- Es de primera parte a propósito. La 2.i de la ToU prohíbe transferir Data
-- "including anonymous, aggregate or derived data" a terceros, y el nivel de
-- confianza de un Player Gap es dato derivado: mandarlo a PostHog o a Plausible
-- exigiría defender por escrito que no cuenta. Guardarlo aquí no.

create table if not exists player_gap_views (
  occurred_at    timestamptz not null default now(),

  -- Identificador anónimo de primera parte, generado en el navegador y con
  -- caducidad (apps/web/src/analytics/visitor.ts). No es una cuenta, no es una
  -- cookie y no se cruza con nada: existe solo para que "usuario único semanal"
  -- sea contable, que es lo que pide la definición de la métrica.
  visitor_id     uuid not null,

  outcome        text not null,
  spec_slug      text not null,
  bracket        text not null,
  target_segment text,
  locale         text not null,

  constraint player_gap_views_outcome_check
    check (outcome in ('high', 'medium', 'insufficient', 'top-segment')),
  constraint player_gap_views_locale_check
    check (locale in ('en', 'es'))
);

comment on table player_gap_views is
  'Una fila por render de la caja Player Gap. Lo que NO hay aquí es tan '
  'deliberado como lo que hay: ni IP, ni user-agent, ni el personaje '
  'consultado. Quién mira a quién no es una métrica de producto, y guardarlo '
  'convertiría una medición agregada en un registro de navegación.';

comment on column player_gap_views.outcome is
  'El desenlace de la caja: ''high''/''medium'' son las dos formas de haber '
  'entregado la comparación, ''insufficient'' es la muestra que no llega y '
  '''top-segment'' es que no hay escalón por encima. El numerador de la North '
  'Star son los dos primeros; el denominador, los cuatro.';

comment on column player_gap_views.spec_slug is
  'Slug canónico de spec (ADR 0016), no el bracket de Blizzard. Se guarda '
  'porque §35 dice que el % de confianza Low alimenta la decisión de '
  'acumulación por búsqueda, y esa decisión necesita saber DÓNDE sube, no solo '
  'que sube.';

comment on column player_gap_views.bracket is
  'Slug de ruta (''solo-shuffle''), el mismo que publica la URL (ADR 0020), no '
  'el ''shuffle-mage-frost'' de la columna bracket de las observaciones.';

comment on column player_gap_views.target_segment is
  'Slug del segmento objetivo, el escalón de arriba. null en top-segment, que '
  'es justo el caso en el que no hay objetivo.';

-- Todas las consultas de la métrica son por ventana temporal —la semana de la
-- North Star, el día de la métrica de salud—, así que el índice es ese y no
-- hay otro. Un índice por spec se añade cuando #31 lo pida con una consulta
-- delante, no antes.
create index if not exists idx_player_gap_views_occurred_at
  on player_gap_views (occurred_at desc);
