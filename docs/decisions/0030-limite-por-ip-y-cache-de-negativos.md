# ADR 0030 — El límite por IP vive en Postgres, la dirección no se guarda, y un 404 se recuerda

**Fecha**: 7 de septiembre de 2026 · **Estado**: aceptada (issue [#71](https://github.com/Atorey/wow-pvp-intelligence/issues/71)) · **Cierra la decisión 7 del [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)**, que dejó pendiente qué se le enseña al jugador cuando se toca el techo, y la consecuencia del [ADR 0028](0028-medicion-de-primera-parte-y-sin-banner.md) sobre `/api/gap-view` sin límite · **Añade un estado al catálogo del [ADR 0024](0024-busqueda-de-personaje-en-la-web.md)**. No revisa ninguna de las tres

## Contexto

El [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md) sacó el presupuesto de Blizzard de la memoria del proceso y lo puso en Postgres, con un colchón reservado que impide que la web deje al pipeline sin cuota. Eso acota el daño y no lo evita: **el colchón no distingue entre mil personas buscando una vez y una persona buscando mil veces**. Cuando se agota, lo que se cae no es la búsqueda, es el `refresh-leaderboard` de esa noche.

Y desde entonces han aparecido dos puertas más. El [ADR 0024](0024-busqueda-de-personaje-en-la-web.md) dejó `GET /api/search`, que no toca la API pero ejecuta una consulta a Postgres por pulsación de teclado; y el [ADR 0028](0028-medicion-de-primera-parte-y-sin-banner.md) dejó `POST /api/gap-view`, el primer endpoint abierto que escribe en la tabla de la North Star. Los tres ADR escribieron en su sitio que el límite es de esta issue.

Falta además una asimetría barata de arreglar: un 404 de Blizzard no deja rastro legible. `character_lookups` es una bitácora en la que hasta hoy solo se escribe, y un personaje que no existe no crea identidad, así que preguntar cien veces por un nombre inventado cuesta cien peticiones. Enumerar un diccionario de nombres sale tan barato como teclearlo.

## Decisión

1. **El límite es un token bucket por clave en Postgres**, en `rate_limit_buckets` ([migración 0015](../../db/migrations/0015_limite_por_ip_del_buscador.sql)). Vive donde vive el presupuesto de Blizzard y por el mismo motivo: en serverless cada invocación es un proceso nuevo, y un contador que no se ve desde otra invocación no cuenta nada. Bucket y no ventana fija, heredando la decisión 4 del ADR 0013.

2. **El descuento es una sola sentencia, un `insert ... on conflict do update`.** La fila puede no existir, y hacerlo en dos pasos dejaría a dos peticiones simultáneas de una clave nueva creyendo cada una que estrena el cubo entero.

3. **La identidad es un HMAC-SHA256 truncado de la dirección IP con una sal secreta del entorno** (`RATE_LIMIT_SALT`). La dirección en claro no se escribe nunca, ni en la tabla ni en un registro. El ámbito entra en el mensaje del HMAC además de ser columna, así que dos cubos de la misma persona no son enlazables ni por quien mire la tabla. Una IPv6 se trunca a su prefijo /64 antes de hashear.

4. **Tres ámbitos con capacidades distintas y hasta dos ventanas por fila**: `submit` —los dos envíos que gastan cuota— 5/min y 60/h, `suggest` 60/min, `gap-view` 60/h. La duración de la ventana no es una propiedad de la columna: llega del entorno en cada sentencia, como las capacidades de la cuota.

5. **Se deja pasar cuando la comprobación falla**, porque el presupuesto de Blizzard vive en la misma base: si no responde, `QuotaLedger` tampoco concede y no se llega a llamar a la API igualmente. Este límite es la primera puerta, no la única. **Se falla al arrancar, en cambio, si falta configuración**: sin `RATE_LIMIT_SALT` se lanza.

6. **Se deja pasar también cuando no llega ninguna dirección.** La alternativa —un cubo compartido para todo el tráfico anónimo— haría que una regresión de cabecera en el hosting no degradase el límite: tumbaría el sitio entero a la vez.

7. **`x-nf-client-connection-ip` primero; `x-forwarded-for` solo como respaldo y por su último salto**, no por el primero.

8. **`rate-limited` es un estado del producto, no un error.** Se dice qué ha pasado, viaja en la URL como los otros desenlaces del ADR 0024, y la página que lo enseña no vuelve a averiguar nada.

9. **Los endpoints responden 429 con `Retry-After` y `Cache-Control: no-store`.**

10. **Un 404 reciente se recuerda**, leyendo `character_lookups` con un `outcome` propio, `not-found-cached` ([migración 0016](../../db/migrations/0016_cache_de_negativos.sql)). Se consulta dentro de `lookupCharacter()` y solo para personajes que no están en la población. `CHARACTER_NOT_FOUND_TTL_MINUTES`, 60 por defecto.

11. **El módulo vive en `apps/web`**, junto a `gap-views.ts`, y no en un paquete.

## Por qué

**Porque el colchón del ADR 0013 protege el presupuesto y no protege el reparto.** Su decisión 5 garantiza que `on-demand` no pueda robarle al batch más allá de la reserva, y eso sigue siendo cierto y sigue haciendo falta. Lo que no dice nada sobre quién gasta esa reserva: 2.000 fichas repartidas entre trescientas personas son un producto funcionando, y las mismas 2.000 en manos de un script son un producto caído para todos los demás durante una hora. Son dos preguntas distintas y necesitan dos mecanismos.

**Porque un hash pelado de una IPv4 no es anónimo, y decir que lo es sería peor que no hashear.** IPv4 son 2³² direcciones: recorrerlas enteras y comparar hashes es cuestión de segundos en un portátil. Lo único que convierte el hash en irreversible es la sal secreta, y por eso es obligatoria y no tiene default — y menos aún uno aleatorio por proceso, que en serverless estrenaría espacio de claves en cada arranque en frío y **desactivaría el límite sin que nada fallase**. Es el modo de fallo más caro de este ADR, porque no se ve: el sitio funciona, los tests pasan, y el límite simplemente no está.

**Porque el último salto de `x-forwarded-for` no es un detalle de implementación.** Quien llama puede enviar su propia cabecera, y el proxy **añade** la dirección real detrás. Quedarse con el primer segmento —que es lo que hace casi todo el código que se encuentra escrito— deja elegir la clave a quien la manda: no solo se salta el límite propio, sino que se puede vaciar el cubo de otra persona escribiendo su dirección. Y el truncado de IPv6 a /64 es el mismo agujero por el otro lado: un cliente doméstico recibe la red entera, así que hashear los 128 bits deja rotar por miles de millones de claves gratis. Los dos fallan en silencio y ninguno se ve en desarrollo local, donde todo es IPv4.

**Porque decirle «no se ha podido consultar» a quien sí puede hacer algo repite el error que el ADR 0024 arregló.** Aquella decisión 7 separó «no existe» de «ahora no puedo mirarlo» porque la primera afirma algo falso. Aquí hay un tercer significado: la consulta se podría hacer, y no se hace porque quien pregunta se ha pasado. Meterlo en `unavailable` sería honesto en la letra —no se ha consultado— y falso en lo que importa, que es si esperar sirve de algo.

**Porque registrar el acierto de la caché como un `not-found` más la haría eterna.** Es la tentación obvia: un valor menos en el check, una migración menos. Lo que ocurre después es que cada acierto escribe una fila con fecha fresca, así que alguien preguntando una vez por minuto mantiene a ese personaje invisible **indefinidamente**, y la métrica que existe para medir cuánta población aporta la búsqueda se llena de filas que no costaron nada. Un valor propio cuesta una línea y arregla las dos cosas.

**Porque `CHARACTER_NOT_FOUND_TTL_MINUTES` es el doble que el del perfil por lo que describe cada uno.** Un perfil describe un estado que cambia después de cada partida; una ausencia describe que alguien no existe, y eso casi nunca deja de ser cierto en la hora siguiente. Una hora convierte el peor ataque realista —enumerar nombres— de una petición por nombre y por intento a una por nombre y por hora, que es lo que hace que este mecanismo y el límite por IP se refuercen en vez de solaparse.

**Porque el módulo no tiene un paquete al que pertenecer.** `packages/blizzard` es lo que habla con la API, y esto también protege a `/api/gap-view`, que no habla con ninguna; `packages/data` es la capa de lecturas ([ADR 0014](0014-capa-de-lectura-compartida.md)) y esto escribe. El precedente exacto —una escritura de la web que no baja a ninguno de los dos— es `gap-views.ts`, con su motivo ya escrito. Inventar un paquete para un fichero que nadie más importa sería crear un paquete por comodidad de un test.

## Consecuencias

- **No hay barrido de filas caducadas, y no lo va a haber en esta issue.** La tabla crece con las direcciones distintas de la última hora. La forma está pensada para que el barrido sea un `delete` por `updated_at` sobre una tabla pequeña, y **borrar una fila es semánticamente inofensivo**: una clave ausente y una con el cubo lleno son indistinguibles por construcción. Es el mismo hueco que tiene abierto [#48](https://github.com/Atorey/wow-pvp-intelligence/issues/48), y aquí es más urgente que en `player_gap_views`, porque esta tabla se escribe en cada petición del sitio y no una vez por vista.
- **Por eso la política de privacidad habla de la ventana y no del borrado.** Prometer «se borra a los X minutos» sería falso el día de publicarse, que es exactamente lo que el ADR 0028 se pilló a sí mismo haciendo con el ciclo de treinta días. Lo que se promete es lo que el código hace: el contador se rellena solo y la huella deja de contar para nada. Endurecer la frase es de #48.
- **La tabla `rate_limit_buckets` no lleva índice sobre `updated_at`**, y eso es lo que mantiene barato el camino caliente: un índice sobre una columna que cambia en cada actualización impide las actualizaciones HOT, y se pagaría en cada petición del sitio a cambio de acelerar un barrido que sobre miles de filas es submilisegundo con recorrido secuencial.
- **No hay topes de longitud de entrada.** `q` en `/api/search` sigue sin máximo. Queda fuera a propósito.
- **`/api/realms` queda sin límite**, y es una omisión decidida: consulta cacheada una hora y pedida una vez al montar.
- **`/api/search` pasa de dos consultas a tres por pulsación**, en el endpoint más caliente y contra un pool de tres conexiones por instancia.
- **CGNAT y NAT corporativo comparten cubo.** Una hermandad en la misma red comparte los cinco envíos por minuto, y por eso las capacidades son variables de entorno y no constantes.
- **5/min es la ráfaga; el régimen sostenido de `submit` es 60/h, o sea uno por minuto.** Quien consulta a diez compañeros seguidos gasta la ráfaga y luego avanza más despacio. Es el comportamiento correcto de un bucket, pero leído como «cinco por minuto» a secas se espera otra cosa.
- **Rotar `RATE_LIMIT_SALT` vacía todos los cubos de golpe.** Es aceptable, y a veces útil, pero conviene saberlo antes de hacerlo en caliente.
- **La cabecera del hosting no está verificada contra un despliegue real.** El `netlify.toml` nunca se ha ejecutado, así que la elección de `x-nf-client-connection-ip` es documental. En el primer despliegue hay que confirmar qué cabeceras llegan de verdad antes de dar esto por cerrado; si no llegara ninguna, la decisión 6 hace que el sitio funcione sin límite en vez de caerse, que es el fallo correcto pero no el deseable.
- **`character_lookups` deja de ser solo bitácora.** Sigue sin tener estado pendiente y sigue creciendo por inserción, pero ahora una fila suya cambia lo que hace la siguiente búsqueda. Es la primera vez que lo que se escribió ahí se lee.
- **La caché de negativos hace invisible durante una hora a un personaje recién creado o renombrado**, y durante esa hora la web dice «Blizzard no conoce ese personaje», que en ese momento es falso. Se compra cuota a cambio de mentir un rato, y se acepta a sabiendas: el caso frecuente es el nombre mal escrito, y el que duele —un traslado de reino— es raro y espera una hora.
- **El `switch` exhaustivo de `describe()` en el CLI y el desenlace de `refreshCharacter` obligan a tratar el `outcome` nuevo.** Sin eso, `not-found-cached` habría caído al `updated` final y la página habría dicho que refrescó a alguien que no existe.
