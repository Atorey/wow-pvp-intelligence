-- Catálogo de media de item: `item_id` → URL del icono (#67, ADR 0022).
--
-- No es un snapshot, y por eso no le aplica la regla 1 del proyecto. Lo que el
-- modelo append-only protege es la observación de un personaje en un instante:
-- reescribir su rating o su gear destruye el histórico. El icono de un item no
-- es una observación de nadie, es un hecho del juego sin histórico que romper,
-- así que aquí sí se hace `update` y no hay nada que preservar.
--
-- Lo que se guarda es el mapeo, nunca el archivo: el PNG vive en un sitio de
-- Blizzard y es Material bajo licencia de uso personal, así que re-alojarlo
-- sería "making publicly available" (ADR 0015, decisión 7). Se enlaza la copia
-- que Blizzard ya publica, y si esa URL deja de responder la página se maqueta
-- sin icono (brief §4.5).
create table if not exists item_media (
  item_id     bigint primary key,
  -- null es "preguntado y no hay icono"; "todavía sin preguntar" es la
  -- ausencia de la fila. Distinguirlos es lo que evita volver a gastar cuota en
  -- cada corrida por los items que la API no resuelve, y encaja con la regla 5:
  -- null nunca significa "no tiene", significa "no disponible".
  icon_url    text,
  -- Cuándo se preguntó, no cuándo cambió el icono. La cláusula 2.s de la ToU
  -- obliga a refrescar todo Data cada 30 días y este mapeo lo es, aunque el
  -- icono en sí no cambie nunca (ADR 0022).
  resolved_at timestamptz not null default now()
);

comment on table item_media is
  'Catálogo item_id → URL del icono en el CDN de Blizzard. No es append-only: es un hecho '
  'del juego, no una observación de un personaje. El archivo no se copia (ADR 0015, decisión 7).';

comment on column item_media.icon_url is
  'URL que devolvió la Media API. null es "preguntado y sin icono"; sin fila es "sin preguntar".';

comment on column item_media.resolved_at is
  'Cuándo se preguntó a Blizzard. Manda sobre el TTL de 30 días de la cláusula 2.s (ADR 0022).';
