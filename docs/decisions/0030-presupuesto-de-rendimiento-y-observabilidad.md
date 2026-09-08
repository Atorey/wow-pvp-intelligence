# ADR 0030 — El presupuesto de rendimiento es un número medido, y la caché caduca con la corrida

**Fecha**: 8 de septiembre de 2026 · **Estado**: aceptada (issue [#72](https://github.com/Atorey/wow-pvp-intelligence/issues/72)) · **Cierra la consecuencia "queda sin decidir, y a propósito, la caché" del [ADR 0014](0014-capa-de-lectura-compartida.md)** · **Se apoya en las decisiones 7 y 10 del [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)** y **respeta la decisión 1 del [ADR 0028](0028-medicion-de-primera-parte-y-sin-banner.md)**: sigue sin haber terceros

## Contexto

El principio 9 de §9 —_"rápido primero, bonito después: un profile que tarda en cargar pierde al usuario antes de demostrar valor"_— es el único de los doce **sin un número detrás**, y por tanto el único que nadie puede incumplir. El propio ADR 0014 aplazó la conversación hasta aquí: _"Cuando #72 mida el presupuesto de rendimiento con páginas reales delante, esa es la conversación — y el sitio donde entraría es este paquete"_.

Lo que había el día de escribir esto:

- **Ninguna caché en las páginas de datos.** Ni `revalidate`, ni `use cache`, ni `Cache-Control`. Lo único era `cache()` de React, que deduplica **dentro** de una petición ([ADR 0029](0029-que-se-indexa-y-que-no.md)), y un `stale-while-revalidate` en `/api/realms`.
- **`computed_at` viajaba y no lo miraba nadie.** Va pegado a cada cifra en `Provenance` desde el ADR 0014, pero ningún componente lo pintaba y ninguna línea lo comparaba con el reloj. La caja Player Gap enseñaba porcentajes sin decir de qué corrida salían, incumpliendo el §28 del plan —_"el frontend nunca muestra un número sin poder trazar de dónde sale **y cuándo se calculó**"_— y el principio 8.
- **Ningún error boundary.** Sin `error.tsx` ni `global-error.tsx`, un pooler que no responde acababa en la pantalla genérica de Next.
- **Nadie se enteraba de nada.** Ningún workflow tenía `if: failure()`, y el docstring de `readSegment` describía el modo de fallo sin dueño: _"una corrida puede fallar, y en ese caso la web enseña el agregado de ayer con su fecha"_ — pero sin que nadie lo supiera.

Y una restricción que decide la forma de todo lo demás: **la página de perfil no puede llevar caché de HTTP**. Consume `searchParams` (`?spec=`, `?tab=`, `?refresh=`), que la decisión 7 del [ADR 0020](0020-mapa-de-rutas-del-sitio.md) fija como parte de su contrato, así que es dinámica por definición; y en el App Router una página no puede fijar cabeceras de respuesta. `use cache` y `cacheLife` existen en Next 16.3.2, pero exigen `cacheComponents: true`, que activa PPR y obliga a meter bajo Suspense **todo** acceso dinámico de la app.

## Decisión

1. **El presupuesto se declara medido, con fecha, método y entorno**, y el método vive en el repo: [`apps/web/scripts/measure-ttfb.ts`](../../apps/web/scripts/measure-ttfb.ts), sin dependencias, contra el mismo `next build` que corre Netlify.

2. **Los números.** Medidos el 8 de septiembre de 2026 en local, Node 22, contra la Postgres real por el pooler de Supabase, 25 peticiones por ruta:

   | Ruta                             | TTFB p75 antes | TTFB p75 ahora |
   | -------------------------------- | -------------- | -------------- |
   | Perfil con Player Gap comparable | 334 ms         | **238 ms**     |
   | Perfil en estado `insufficient`  | 184 ms         | **177 ms**     |
   | `/sitemap.xml`                   | 45 ms          | **5 ms**       |
   | Portada (prerenderizada)         | —              | **9 ms**       |

   Y el consumo real de la página que importa: **de 10 consultas por visita a 7** en instancia caliente.

   **El presupuesto queda en TTFB p75 ≤ 800 ms y LCP p75 ≤ 2,5 s en el perfil**, con un techo duro que no es negociable: los 10 s de función de Netlify. Los 800 ms son ~3,4× lo medido, y el margen es deliberado: lo medido es local, y producción añade el arranque en frío y una red que aquí no está.

3. **Estas cifras son locales y no de producción, y así se declaran.** El sitio no está conectado a Netlify todavía, así que medir en producción exigía meter el despliegue dentro de esta issue. La tabla se vuelve a llenar cuando exista sitio; hasta entonces dice lo que es.

4. **La vigencia de la caché sale de `computed_at`, no de una TTL.** La regla vive en [`packages/core/src/freshness.ts`](../../packages/core/src/freshness.ts) y la comparten la web y el pipeline, por lo mismo que `canShowComparison()`: si "está viejo" se escribiera dos veces, serían dos reglas que coinciden de milagro.

5. **La caché es memoria de proceso, y solo de las lecturas de agregado.** De las 10 consultas de un perfil, 3 no son del personaje sino del escalón —los segmentos del bracket y las dos adopciones—: idénticas para todo el que mire esa spec y renovadas una vez al día. Vive en [`apps/web/src/server/aggregate-cache.ts`](../../apps/web/src/server/aggregate-cache.ts) y la usa también el sitemap.

6. **Y tiene un suelo de 5 minutos.** Es lo que apareció al medir y no al diseñar: cuando una corrida se retrasa, su caducidad natural **ya está en el pasado**, así que una caché que solo mirase esa fecha fallaría en todas las visitas — desapareciendo justo el día que el recálculo está caído, y para nada, porque hasta que no corra el job no hay dato nuevo que traer.

7. **`cacheComponents` se rechaza por ahora.** Cachearía también el trabajo de render y es lo idiomático en Next 16, pero es una migración de la app entera a PPR. Se revisa cuando haya una medición de producción que la justifique, no antes.

8. **La fecha de la corrida se enseña siempre en la caja Player Gap**, y cuando la corrida vigente ya no es la que debería haber, se dice. Sin fecha de vuelta ni ETA, como toda ausencia declarada (§2.5 del [brief](../design/brief.md)).

9. **Los tres fallos que pedía el issue, cada uno con su respuesta.** Los dos primeros ya estaban resueltos y aquí solo quedan por escrito:
   - **Blizzard responde 404** → `not-found`, en el buscador y en el botón Actualizar. La regla de la decisión 7 del [ADR 0024](0024-busqueda-de-personaje-en-la-web.md) sigue mandando: _"no se pudo mirar" nunca se enseña como "no existe"_.
   - **Cola saturada o sin cuota** → `unavailable`, con el presupuesto de 8 s del ADR 0013. La causa —`quota` o `deadline`— se funde en la interfaz a propósito, porque al jugador no le sirve, y **se separa en el registro**, porque a quien opera sí.
   - **El segmento no tiene agregado del día** → la caja lo dice con la fecha delante (decisión 8) y el vigilante lo convierte en un correo (decisión 10).

10. **Quién se entera: de primera parte, sin terceros.** Una línea JSON por suceso a stderr, que Netlify recoge ([`log.ts`](../../apps/web/src/server/log.ts)), levantada por `onRequestError` ([`instrumentation.ts`](../../apps/web/src/instrumentation.ts)); y un vigilante, `npm run pipeline -- check-freshness`, en su propio workflow diario, que **falla** si los agregados que sirve la web son de una corrida perdida. El aviso es el correo de GitHub por un workflow programado que falla.

11. **En el registro no entra nada de quien mira.** Ni IP, ni user-agent, ni la ruta resuelta: se registra la **forma** (`/[locale]/player/[region]/[realm]/[name]`), que dice qué se rompió sin decir a quién. La política de privacidad promete que de quien visita no se guarda nada (ADR 0028, decisión 5), y unos registros con el nombre del personaje dentro serían el historial de visitas que dice que no existe.

12. **`generateMetadata` deja de poder tumbar la página.** Corre fuera de todo boundary, así que una excepción suya se saltaba el `error.tsx`. Ahora se traga y devuelve lo mínimo, con `noindex`: sin perfil no se puede afirmar que haya comparación.

## Por qué

**Porque la fecha ya estaba escrita en cada fila y nadie la usaba para nada.** La tentación con este issue es elegir una TTL —quince minutos, una hora— y defenderla con que "los datos cambian poco". Pero es que no cambian poco: cambian **exactamente una vez al día**, y sabemos cuándo porque la propia fila lo dice. Una TTL inventada acierta por casualidad y deja de acertar en silencio el día que se toque la cadencia de `refresh-aggregates`. Derivarla de `computed_at` no es más elegante: es que no puede desincronizarse.

**Porque el suelo de la decisión 6 no se habría escrito sin medir, y ese es el argumento de todo el issue.** La primera versión de esta caché usaba la caducidad a secas y era, sobre el papel, impecable. Contra la base real —cuya corrida vigente era del 29 de agosto, diez días atrás— no cacheaba absolutamente nada: fallaba las tres visitas de tres. Una caché que se evapora cuando el pipeline está caído es peor que no tenerla, porque su ausencia coincide con el momento de más carga inútil. Eso no sale de leer el código; sale de contar consultas contra una base de verdad, que es lo que el issue pedía al escribir "medido, no estimado".

**Porque un número sin margen es un número que se incumple el primer día.** El presupuesto podría haberse fijado en 300 ms, que es lo medido con holgura. Sería un presupuesto que falla en cuanto se despliegue, porque lo medido no incluye ni el arranque en frío de Netlify ni la latencia de red de un visitante. 800 ms es 3,4× lo local y sigue estando por debajo de lo que se nota; y cuando haya cifra de producción, se aprieta con ella delante en vez de con una intuición.

**Porque "quién se entera" no puede costar un tercero.** El ADR 0028 dejó cerrada la puerta a los servicios alojados fuera, y con razón: la 2.i de la ToU de Blizzard prohíbe transferir Data a terceros sin adjetivos. Un Sentry recibiría stack traces, que no son Data derivada, y probablemente se podría defender — pero habría que defenderlo, y a cambio de qué. Lo que hacía falta era enterarse de dos cosas: que una página revienta y que los agregados se han quedado atrás. La primera es una línea JSON en unos registros que ya existen; la segunda es una consulta de agregación y un `process.exit(1)`. Ninguna de las dos justifica reabrir una conversación legal.

**Porque el vigilante mira el efecto y no el job.** Un paso más al final de `aggregates.yml` habría sido más barato y habría cubierto menos: solo se ejecuta si esa corrida llega a arrancar, y "no arrancó" es justo uno de los casos que hay que detectar — GitHub deshabilita los crons de un repositorio inactivo sin avisar. Preguntarle a la base "¿el dato que estás sirviendo es de hoy?" no depende de que ningún job funcione.

## Consecuencias

- **`packages/core` gana una tercera puerta única.** Junto a `canShowComparison()` y `isActiveWithin()`, ahora `isAggregateStale()`. El umbral son 36 horas y no 24 a propósito: el cron de Actions no es puntual, y una alarma que salta cada vez que la corrida se retrasa media hora se ignora a las tres semanas.
- **La caché no vive en `packages/data`, donde el ADR 0014 supuso que acabaría.** Ese paquete lo comparten web y pipeline, y `refresh-aggregates` lee agregados **para escribir los siguientes**: servirle una foto recordada sería calcular la corrida de mañana sobre la de ayer. La web es la única de las dos que solo lee, así que la caché es suya. Es una corrección a aquella previsión, no una desviación.
- **Es memoria de proceso y no sobrevive a la instancia.** En serverless lo que ahorra es el tráfico de una instancia caliente que sirve varias visitas seguidas, que es el caso normal y no es poco — pero no promete más. Un caché compartido sigue sin existir y sigue sin hacer falta.
- **La página de perfil sigue sin cabecera de caché, y debe seguir así.** Lleva `?refresh=` en la URL después de pulsar Actualizar, y esa respuesta no puede acabar en un CDN sirviéndosela a otro.
- **El aviso de corrida vieja se está enseñando hoy.** Con la corrida vigente del 29 de agosto, cualquier perfil que se abra ahora mismo dice que sus cifras tienen más de un día, y `check-freshness` sale con código 1. No es un caso hipotético dibujado por si acaso: es el estado real de la base al escribir esto, y la razón de que el vigilante exista.
- **`error.tsx` y `global-error.tsx` pintan en cliente, no en servidor.** Medido: ante un fallo del render inicial, Next 16 sirve su propia cáscara con un 500 y el boundary aparece al hidratar, así que un visitante sin JavaScript ve un 500 sin texto. Es comportamiento del framework y no se ha forzado: la alternativa era capturar la excepción en cada página y devolver **200** con una explicación, que le mentiría a los rastreadores sobre una página que no ha podido leerse. El registro se escribe en los dos casos.
- **Aparece el primer `console.*` de `apps/web`, y es el único.** Es un catálogo cerrado de tres sucesos, no texto libre: lo que no esté en `ServerEvent` no se registra.
- **La cobertura servible por par `(spec, segmento)` sigue sin vigilarse**, y no se ha tocado aquí: eso es [#74](https://github.com/Atorey/wow-pvp-intelligence/issues/74). Este vigilante mira frescura —¿hay corrida de hoy?—, que es otra pregunta.
- **El LCP sigue sin medir y hay que medirlo con un navegador.** El presupuesto lo declara, la tabla no lo trae: exige Lighthouse, y añadirlo como dependencia para una cifra que se toma cuatro veces al año no compensa. En el perfil, además, el LCP es casi el TTFB — no hay imagen de héroe y el contenido es texto renderizado en servidor.
- **`generateMetadata` sigue cargando el perfil entero antes del primer byte**, porque necesita el estado de la caja para decidir `robots` (ADR 0029, decisión 4). Es la razón de que el TTFB del perfil sea el coste de sus datos, y de que meter el Player Gap en un Suspense no compraría nada mientras esa regla siga en pie. Se deja nombrado, no resuelto.
