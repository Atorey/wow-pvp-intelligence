-- PopulationSegment + AggregateSnapshot (§27 y §28 del plan, #15).
--
-- Hasta ahora la distribución por segmento se calculaba al vuelo para
-- imprimirla en el log de la ingesta, y los adoption_rate se recalculaban en
-- memoria desde un run muestreado cada vez que alguien pedía un Player Gap.
-- Eso no se puede consultar, no tiene `computed_at` y no deja histórico: §28
-- exige que "cada AggregateSnapshot almacene sample_size y computed_at" para
-- que el frontend nunca muestre un número sin poder trazar de dónde sale, y
-- §27 define Trend (#27) como la comparación de dos AggregateSnapshot
-- consecutivos del mismo segmento — que no existe si no se guardan.
--
-- Estas dos tablas son DERIVADAS: se pueden reconstruir enteras a partir de
-- character_snapshots, que sigue siendo la única fuente de verdad append-only
-- (ADR 0002). Borrar un recálculo no destruye histórico de población; borrar un
-- snapshot, sí. Cada corrida inserta un juego nuevo de filas con su
-- `computed_at`; nunca se hace UPDATE sobre un recálculo anterior, porque el
-- histórico de agregados es justo lo que alimenta las tendencias.

-- 1) El escalón: quién hay en (temporada, bracket, spec, rango de rating) y qué
--    forma tiene esa población.
create table if not exists population_segments (
  id                    bigserial primary key,
  -- Igual para todas las filas de una misma corrida: identifica el recálculo.
  computed_at           timestamptz not null,
  region                text        not null,
  season_id             int         not null,
  bracket               text        not null,        -- p.ej. 'shuffle-mage-frost'
  class_slug            text        not null,
  spec_slug             text        not null,
  segment_id            text        not null,        -- '1800-2000', clave estable en BD y URLs
  segment_min           int         not null,
  -- null = tramo abierto de arriba ('3000+'). No se finge un máximo que no existe.
  segment_max           int,
  -- Ventana de actividad aplicada a ESTA fila (§27, "Active Players"). Puede
  -- diferir entre segmentos del mismo bracket: 7 días si llega a muestra, 14 si
  -- no (§13.4). Se guarda por fila porque es parte de la definición del número.
  activity_window_days  int         not null,
  -- Personajes activos del segmento: el n que sostiene la confianza (ADR 0003).
  sample_size           int         not null,
  confidence            text        not null check (confidence in ('high', 'medium', 'insufficient')),
  rating_median         numeric,
  rating_p25            numeric,
  rating_p75            numeric,
  rating_min            int,
  rating_max            int,
  equipped_item_level_median numeric,
  -- Denominadores reales de cada bloque, que casi nunca coinciden con
  -- sample_size: el rating llega del leaderboard para todos, pero gear,
  -- talentos e item level solo existen donde hemos bajado el perfil completo.
  -- Sin estas tres columnas, un adoption_rate del 60% se leería como "60% del
  -- segmento" cuando es "60% de los 40 perfiles que tenemos de 3.000 personas".
  item_level_sample     int         not null default 0,
  gear_sample           int         not null default 0,
  talent_sample         int         not null default 0,
  -- Rango temporal de los perfiles usados. El rating es de hoy, pero el gear
  -- puede ser del muestreo de hace días: son fuentes distintas del mismo
  -- personaje y la diferencia tiene que poder verse, no suponerse.
  profile_data_from     timestamptz,
  profile_data_to       timestamptz,
  -- Personajes activos en la ventana que quedaron fuera por venir solo de
  -- búsquedas de usuario (source = 'search'). Entran por sesgo de selección
  -- —alguien se interesó por ellos— y mezclarlos contaminaría el denominador
  -- (ver migración 0004 y ADR 0007). Se cuentan aquí para poder medir cuánta
  -- población nos estamos dejando y revisar la decisión con dato delante.
  excluded_search       int         not null default 0,
  unique (region, season_id, bracket, segment_id, computed_at)
);

-- La query caliente del producto es "el agregado más reciente de este segmento".
create index if not exists idx_population_segments_latest
  on population_segments (region, season_id, bracket, segment_id, computed_at desc);

-- 2) El adoption_rate de cada variable dentro de un escalón (§13.2).
create table if not exists aggregate_snapshots (
  id                    bigserial primary key,
  population_segment_id bigint not null references population_segments(id) on delete cascade,
  -- Conjunto cerrado: son las variables que el schema de hoy puede observar.
  -- Stats secundarias y embellishments no están porque no se guardan; los nodos
  -- de talento sueltos esperan a #24. Ampliarlo es una decisión, no un descuido.
  variable_kind         text   not null check (variable_kind in ('gear-item', 'talent-code')),
  -- 'TRINKET:207581' o el talent_loadout_code completo.
  variable_key          text   not null,
  -- Grupo de slots normalizado: 'TRINKET', nunca 'TRINKET_1'. En WoW da igual en
  -- qué hueco va cada abalorio, y separarlos partiría la adopción del mismo item
  -- en dos. null en talentos.
  slot_group            text,
  item_id               bigint,
  -- Nombre legible en el momento del cálculo, para pintar sin resolver ids.
  -- null significa "no disponible" (regla 5), no "sin nombre".
  item_name             text,
  users                 int    not null,
  -- Población con dato disponible: la base real del porcentaje, no el tamaño
  -- del segmento.
  denominator           int    not null,
  -- Excluidos por dato no disponible (regla 5): un personaje del que solo
  -- tenemos la fila de leaderboard no es alguien que "no lleva ese item".
  unavailable           int    not null default 0,
  adoption_rate         numeric not null,
  unique (population_segment_id, variable_kind, variable_key)
);

-- Para "cómo ha evolucionado la adopción de este item" (#27) y para el gear
-- analytics por segmento (#22), que buscan por variable a través de segmentos.
create index if not exists idx_aggregate_snapshots_variable
  on aggregate_snapshots (variable_kind, variable_key);
