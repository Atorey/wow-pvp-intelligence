-- Límite de peticiones por IP para los endpoints abiertos de la web (ADR 0030).
--
-- La búsqueda con fallback a la API es una puerta directa a la cuota del client
-- ID, que se comparte con el pipeline. Sin límite, lo que se cae cuando alguien
-- abusa no es la búsqueda: es el refresh-leaderboard de esa noche. El colchón
-- reservado del ADR 0013 acota el daño pero no lo evita, porque no distingue
-- entre mil personas buscando una vez y una buscando mil veces.
--
-- El contador vive aquí y no en la memoria del proceso por lo mismo que el
-- presupuesto de Blizzard (ADR 0013): cada invocación de la web es un proceso
-- nuevo, y un límite que no se ve desde otra invocación no limita nada.
--
-- Token bucket y no ventana fija, igual que blizzard_quota: una ventana permite
-- gastar el presupuesto entero al final de una y otro entero al principio de la
-- siguiente. El bucket se rellena a tasa constante y no tiene bordes.
--
-- No es append-only y no le aplica la regla 1 del proyecto: no es la observación
-- de un personaje, es un contador de infraestructura que solo tiene sentido en
-- su valor actual. Mismo razonamiento que blizzard_quota e item_media.
create table if not exists rate_limit_buckets (
  -- Qué se está limitando. La clave va primero para que borrar o contar por
  -- ámbito sea un recorrido de rango del índice primario, que es lo que se
  -- querrá mirar el día que haya que saber qué endpoint recibe la avalancha.
  --
  -- Sin `check` sobre los valores, a diferencia de character_lookups.outcome:
  -- ahí el valor es una dimensión que se analiza y la consistencia compra algo.
  -- Aquí es un discriminador de espacio de claves cuya lista canónica está en
  -- TypeScript, y un check obligaría a una migración cada vez que se limite un
  -- endpoint nuevo.
  scope        text not null,

  -- HMAC truncado de la dirección IP, nunca la dirección. La sal es un secreto
  -- del entorno, que es lo único que hace irreversible un hash sobre un espacio
  -- de 2^32 direcciones. El ámbito entra también en el mensaje del HMAC, así que
  -- dos cubos de la misma persona no son enlazables ni por quien mire la tabla.
  key_hash     text not null,

  -- Fichas de las dos ventanas. Se guardan como float porque el rellenado es
  -- continuo: entre dos peticiones separadas 40 ms entra una fracción de ficha,
  -- y truncarla a entero la regalaría en cada petición.
  --
  -- Los nombres son `short` y `long` y no `minute` y `hour` a propósito: la
  -- duración de la ventana no es una propiedad de la columna, llega como
  -- parámetro desde el entorno en cada sentencia. Hay ámbitos cuya única ventana
  -- es horaria, y usan `short`: el corto es el obligatorio, no el breve.
  short_tokens double precision not null,
  -- Nula para los ámbitos de una sola ventana. Una fila que la tenga nula y un
  -- ámbito que empiece a tenerla se tratan como bucket lleno, que es lo correcto:
  -- esa clave nunca ha gastado nada de la ventana que acaba de aparecer.
  long_tokens  double precision,

  -- Reloj del rellenado: los buckets se recargan al mirarlos, no con un job.
  --
  -- Sin backdating, al revés que blizzard_quota. Allí la fila la crea esta misma
  -- migración con los buckets a cero y hay que retrasarle el reloj para que el
  -- primer job no espere una hora. Aquí la fila nace en la propia petición que
  -- gasta su primera ficha, con `capacidad - 1` ya dentro: una clave nueva es un
  -- bucket lleno por construcción.
  updated_at   timestamptz not null,

  primary key (scope, key_hash)
);

-- No hay índice sobre updated_at, y es deliberado. Un índice sobre una columna
-- que cambia en cada actualización impide las actualizaciones HOT, así que cada
-- petición del sitio escribiría además una entrada de índice y lo fragmentaría
-- hasta que pasase autovacuum. La tabla está acotada por (IPs distintas de la
-- última hora x ámbitos) —del orden de miles de filas—, así que el barrido que
-- venga puede permitirse un seq scan de sobra. Se paga en cada petición lo que
-- ahorraría una vez cada varios minutos.

-- Las capacidades y las tasas NO son columnas, por lo mismo que en
-- blizzard_quota: llegan como parámetros desde el entorno en cada sentencia
-- (RATE_LIMIT_SUBMIT_PER_MINUTE y compañía). Duplicarlas aquí obligaría a un
-- comando para cambiarlas y a decidir cuál de las dos manda.

comment on table rate_limit_buckets is
  'Token buckets por ámbito y por IP para los endpoints abiertos de la web (ADR 0030). '
  'No append-only: es infraestructura, no una observación. Borrar una fila es inofensivo, '
  'porque una clave ausente y una con el cubo lleno son indistinguibles por construcción.';

comment on column rate_limit_buckets.key_hash is
  'HMAC-SHA256 truncado de la IP con una sal secreta del entorno. La dirección no se guarda '
  'nunca, ni aquí ni en un registro, y de esta columna no se puede recuperar.';

comment on column rate_limit_buckets.updated_at is
  'Reloj del rellenado. Nada borra las filas todavía: el barrido es un delete por esta columna.';
