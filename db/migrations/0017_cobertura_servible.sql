-- La serie histórica de la cobertura servible por par (spec, segmento)
-- (ADR 0032).
--
-- La cobertura no es un hecho fijo: en una temporada madura el tope de 5.000
-- corta el rango bajo del ICP, y en una recién empezada el tope no aplica y lo
-- que falta es la parte alta. Los dos perfiles se midieron con dos semanas de
-- diferencia y son inversos (§12 de docs/sprint-0-findings.md). Hasta ahora ese
-- número salía de consultas a mano que no quedaban guardadas en ningún sitio,
-- que es exactamente cómo caducó §3 de findings sin que nadie se enterase.
--
-- Es una tabla DERIVADA, como population_segments: se puede reconstruir entera
-- desde character_snapshots. Cada corrida de refresh-aggregates inserta un juego
-- nuevo de filas con su computed_at y nunca actualiza el anterior — el histórico
-- es el producto, no un efecto secundario.
--
-- Y no es redundante con population_segments aunque salga de ella, por dos
-- cosas que aquella no puede decir:
--
--   1) El par cruza DOS escalones. Lo que decide un Player Gap es el segmento
--      objetivo, no el del sujeto (ADR 0010, decisión 2), y esa relación no
--      existe en una tabla cuya fila es un escalón suelto.
--   2) El objetivo vacío no tiene fila. refresh-aggregates no escribe segmentos
--      sin población, así que "encima de estos 400 sujetos no hay nadie" solo se
--      puede leer como una ausencia — y una ausencia no se distingue de un job
--      que no corrió. Aquí ese caso es un cero escrito.

create table if not exists segment_coverage (
  id                 bigserial primary key,
  -- Igual para todas las filas de una corrida, y el mismo valor que lleva la
  -- corrida de population_segments que la produjo: las dos se leen juntas.
  computed_at        timestamptz not null,
  region             text        not null,
  season_id          int         not null,
  bracket            text        not null,
  class_slug         text        not null,
  spec_slug          text        not null,

  -- El escalón de los sujetos: desde dónde se mira.
  subject_segment_id text        not null,
  subject_segment_min int        not null,
  -- Cuántos hay, con la ventana de actividad de su propia fila.
  subjects           int         not null,

  -- El escalón objetivo: contra qué se compara. Se guarda aunque se pueda
  -- derivar de la escala porque la escala es un parámetro que cambia por
  -- temporada, y la fila tiene que decir qué dos tramos se emparejaron el día
  -- que se calculó, no los que emparejaría hoy.
  segment_id         text        not null,
  segment_min        int         not null,
  -- null = tramo abierto de arriba. No se finge un máximo que no existe.
  segment_max        int,

  -- Los dos denominadores del objetivo, separados a propósito: el primero es
  -- población y el segundo es base de comparación, y difieren en órdenes de
  -- magnitud. Un par se sirve por el segundo (ADR 0010, decisión 3).
  sample_size        int         not null,
  gear_sample        int         not null,
  -- Ventana con la que se contó el objetivo. null cuando el objetivo no tiene
  -- fila: no hubo población con la que elegirla.
  activity_window_days int,

  unique (region, season_id, bracket, subject_segment_id, computed_at)
);

comment on table segment_coverage is
  'Cobertura servible por par (spec, segmento objetivo), una fila por corrida. '
  'Solo hay fila donde hay SUJETOS: un objetivo poblado sin nadie debajo no le '
  'sirve a ningún jugador (ADR 0010, decisión 5), y contarlo convertiría el '
  'fondo de la ladder en una métrica tranquilizadora.';

comment on column segment_coverage.sample_size is
  'Población del segmento OBJETIVO, no la del sujeto. 0 significa que ahí '
  'arriba no hay nadie en la ventana, no que no se mirase.';

comment on column segment_coverage.gear_sample is
  'Base de comparación del segmento objetivo: con cuántos de ellos hay gear '
  'legible. Es la cifra que decide si el par se sirve. Nunca se guarda aquí el '
  'nivel de confianza derivado de ella: se deriva al leer con confidenceFor(). '
  'Guardar el juicio en vez del número que lo sostiene es lo que dejó a '
  'population_segments.confidence con filas high y gear_sample = 0.';

-- Las dos consultas de esta tabla son "la cobertura de la última corrida" y "la
-- serie de las últimas N corridas". Las dos empiezan por región y ordenan por
-- computed_at, así que el índice es ese y no hay otro. La temporada no entra:
-- la serie que importa es justo la que cruza el reinicio de la ladder, y meter
-- season_id delante de computed_at dejaría sin índice la consulta que lo cruza.
create index if not exists idx_segment_coverage_run
  on segment_coverage (region, computed_at desc);
