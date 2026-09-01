-- Presupuesto de cuota de Blizzard compartido entre procesos (ADR 0013).
--
-- Hasta aquí la cuenta vivía en la memoria de `RequestQueue`, y toda su
-- corrección descansaba en una invariante que se cumplía sola: un proceso a la
-- vez posee las 36.000 peticiones/hora enteras. Con la web en serverless cada
-- invocación es un proceso nuevo que arranca creyendo lo mismo, así que el
-- techo se multiplica por N y quien se lleva los 429 es el batch de esa noche.
--
-- Una fila, dos token buckets (por segundo y por hora) y el token de OAuth.
-- No es append-only y no le aplica la regla 1 del proyecto: no es la
-- observación de un personaje en un instante, es un contador de infraestructura
-- que solo tiene sentido en su valor actual. Mismo razonamiento que `item_media`.
create table if not exists blizzard_quota (
  -- Fila única: el presupuesto es uno porque el client ID es uno. El check
  -- convierte en error de base de datos lo que sería un segundo presupuesto
  -- fantasma repartiendo cuota que no existe.
  id               smallint primary key default 1 check (id = 1),

  -- Fichas disponibles. Se guardan como float porque el rellenado es continuo:
  -- entre dos peticiones separadas 40 ms se acumula una fracción de ficha, y
  -- truncarla a entero regalaría el resto en cada petición.
  second_tokens    double precision not null default 0,
  hour_tokens      double precision not null default 0,

  -- Momento del último descuento. Es lo que hace de reloj del rellenado: los
  -- buckets no se recargan con un job, se recargan al mirarlos.
  --
  -- Nace con una hora de retraso a propósito. El rellenado es
  -- `least(capacidad, fichas + segundos_transcurridos * tasa)`, así que
  -- backdatear deja los dos buckets llenos en la primera petición; sin eso, el
  -- primer job después de migrar esperaría una hora por una cuota que nadie ha
  -- gastado todavía.
  updated_at       timestamptz not null default now() - interval '1 hour',

  -- Token de OAuth, aquí y no en la memoria del proceso (ADR 0013, decisión 8).
  -- En un proceso encendido cachearlo en memoria es una petición cada 24 h; en
  -- serverless es una por arranque en frío, y ninguna la cuenta nadie.
  --
  -- Es una credencial: no se registra en logs. Y la comparte quien comparta
  -- client ID, que es justo el aviso de la decisión 9 sobre los deploy previews.
  access_token     text,
  token_expires_at timestamptz
);

-- Las capacidades y las tasas NO son columnas: llegan como parámetros desde el
-- entorno en cada sentencia (BLIZZARD_REQUESTS_PER_HOUR y compañía). Su sitio ya
-- es la configuración del proceso, y duplicarlas aquí obligaría a un comando
-- para cambiarlas y a decidir cuál de las dos manda. El precio es que un proceso
-- mal configurado rellena más rápido de lo que debe, y por eso el valor se
-- documenta en los tres sitios donde vive: .env.example, los secretos de Actions
-- y las variables del sitio en Netlify.
insert into blizzard_quota (id) values (1) on conflict (id) do nothing;

comment on table blizzard_quota is
  'Presupuesto de cuota de Blizzard compartido por todos los procesos (ADR 0013): dos token '
  'buckets y el token de OAuth. Fila única, no append-only: es infraestructura, no una observación.';

comment on column blizzard_quota.updated_at is
  'Reloj del rellenado: los buckets se recargan al mirarlos, no con un job.';

comment on column blizzard_quota.access_token is
  'Token de OAuth compartido (decisión 8). Es una credencial: no se registra en logs.';
