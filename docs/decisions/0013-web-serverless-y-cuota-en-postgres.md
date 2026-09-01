# ADR 0013 — La web es serverless y el presupuesto de cuota vive en Postgres

**Fecha**: 22 de agosto de 2026 · **Estado**: aceptada (issue #60) · **Revisa las decisiones 4 y 5 del [ADR 0005](0005-cola-de-peticiones-con-prioridades.md)** —la cola sigue existiendo, pero deja de ser el techo— y cierra la fila "Infra" de §29 del plan para la web. No toca el batch ([ADR 0004](0004-job-programado-del-leaderboard.md))

## Contexto

`RequestQueue` lleva la cuenta de la cuota **en la memoria del proceso** ([request-queue.ts](../../apps/pipeline/src/blizzard/request-queue.ts)): `grants`, `nextSlotAt` y los contadores por prioridad no sobreviven al proceso ni se ven desde otro. Toda su corrección descansa en una invariante que hoy se cumple sola: **un proceso a la vez posee la cuota entera**.

Esa invariante se rompe en cuanto entra la web. §30 fija el límite en **36.000 peticiones/hora y 100/s por client ID** —por credencial, no por servidor—, y [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19) pide búsqueda de personaje con fallback a la API. Si cada invocación de la web es un proceso nuevo, cada uno arranca creyendo que tiene las 36.000 enteras. El techo se multiplica por N, las prioridades dejan de significar nada —solo se puede ordenar lo que compite por el mismo turno— y el que se lleva los 429 no es la web: es el `refresh-leaderboard` de esa noche, porque la web reintenta y el cron no vuelve hasta dentro de tres horas.

El propio [ADR 0005](0005-cola-de-peticiones-con-prioridades.md) dejó escrito el disparador —_"si el proyecto llega a tener varios procesos concurrentes de forma habitual, esto necesita un ADR nuevo, no un ajuste de variable"_— y el [ADR 0004](0004-job-programado-del-leaderboard.md) el motivo —_"Actions no sirve para trabajo disparado por un usuario que está esperando"_. Este es ese ADR.

Los datos de hosting, verificados el 22 de agosto de 2026: el plan gratuito de **Vercel prohíbe el uso comercial** de forma explícita, algo incompatible con §36; el de **Netlify lo permite**, con un techo de 300 créditos al mes y **10 segundos de timeout** por función. Un proceso encendido permanentemente (Fly.io) cuesta ~2 $/mes en su configuración mínima.

## Decisión

1. **La web se despliega serverless, en Netlify.** Se acepta que cada invocación es un proceso nuevo y efímero: no se intenta preservar la invariante del ADR 0005, se sustituye.

2. **La búsqueda es síncrona: la web llama a Blizzard con el jugador esperando.** Importa `lookupCharacter()` tal cual, como ya previó la decisión 1 del [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md). No se levanta un servicio HTTP intermedio ni se difiere el trabajo a una pasada posterior del pipeline.

3. **El presupuesto de cuota sale de la memoria y pasa a Postgres.** Una fila única con **dos token buckets** —uno por segundo, uno por hora— y una sentencia atómica que descuenta la ficha y devuelve si la había. Cualquier proceso, efímero o no, pide permiso ahí antes de llamar a Blizzard. `BLIZZARD_REQUESTS_PER_HOUR` deja de ser un margen por proceso y pasa a ser el techo real y compartido.

4. **Token bucket, no ventana.** Una ventana horaria fija permite gastar el presupuesto entero al final de una hora y otro entero al principio de la siguiente: 48.000 peticiones en sesenta minutos reales sin que ningún contador proteste. El bucket se rellena a tasa constante y no tiene bordes que explotar.

5. **La prioridad deja de ser un orden y pasa a ser una reserva.** Un proceso efímero no puede esperar su turno en una cola que no ve. `on-demand` puede gastar hasta la última ficha; `batch` y `aggregate` solo obtienen permiso si el bucket horario está por encima de un colchón reservado (`BLIZZARD_ON_DEMAND_RESERVE`, 2.000 por defecto ≈ 330 búsquedas). Es la respuesta que el propio ADR 0005 anticipó para la inanición.

6. **`RequestQueue` no desaparece.** Sigue espaciando y ordenando **dentro** de cada proceso, que es donde el pipeline tiene miles de peticiones que ordenar. Lo que cambia es que `acquire()` ya no concede por su cuenta: pide la ficha a la tabla y el permiso final lo da Postgres.

7. **Quien tiene un humano delante espera poco y lo dice.** El lookup de la web lleva un presupuesto de tiempo total explícito (8 s, por debajo de los 10 s de Netlify); agotado, responde "ahora mismo no puedo mirarlo" en vez de consumir el timeout. El batch, que no tiene a nadie esperando, sigue esperando lo que haga falta. Qué se le enseña exactamente al jugador es de [#71](https://github.com/Atorey/wow-pvp-intelligence/issues/71).

8. **El access token se cachea en la misma tabla, no en la memoria del proceso.** Hoy [`getAccessToken()`](../../apps/pipeline/src/blizzard/client.ts) lo guarda en el objeto y lo pide con un `fetch` que **no pasa por la cola**. En un proceso encendido eso es una petición cada 24 horas; en serverless es una por arranque en frío, y ninguna la cuenta nadie.

9. **La cuota se comparte con quien comparte credencial.** Los deploy previews de Netlify ejecutan funciones reales: o apuntan a la misma tabla que producción, o usan un client ID propio. Un preview con el client ID de producción y otra base de datos gasta cuota que nadie está contando.

10. **Las funciones se conectan por el pooler de Supabase en modo transacción**, no abriendo un `pg.Pool` por invocación. Postgres tiene un techo de conexiones bastante más bajo que el de invocaciones concurrentes que Netlify puede levantar.

11. **El batch no se mueve.** `refresh-leaderboard` sigue en Actions: 3-4 peticiones cada 3 horas caben en cualquier colchón. Pide permiso a la tabla igual, porque el valor de la decisión 3 es que **no haya excepciones**.

## Por qué

**Porque el problema no es dónde corre la web, es dónde vive la cuenta.** Las tres opciones del issue atacan el síntoma: todas buscan restaurar la invariante "un solo proceso" —encolando el trabajo, centralizándolo tras HTTP, o pagando un contenedor encendido—. Ninguna arregla que un estado compartido esté guardado en un sitio que no se comparte. Moverlo a la base de datos que ya existe hace la cuenta correcta **haya un proceso o cien**, y por eso es la única opción que no hay que revisar el día que cambie el hosting.

**Porque la búsqueda diferida mata la feature que justifica la búsqueda.** La opción (a) —encolar en `character_lookups`— cuesta además una migración que le cambia la naturaleza a la tabla: es una **bitácora**, con un check cerrado sobre resultados ya ocurridos (`ok|cached|not-found|no-brackets|error`) y sin estado pendiente, y su propio comentario dice "observación del pipeline, no población". Pero lo caro no es la migración. §12 llama a la acumulación por búsqueda "necesaria, no opcional" porque es la **única** vía de población por debajo del corte de 5.000 del leaderboard. Un jugador de 1600 que busca su nombre, lee "lo estamos buscando, vuelve luego" y se va, no vuelve — y con él no vuelve el dato que lo justificaba todo.

**Porque pagar un contenedor compra la invariante, no la protege.** La opción (c) funciona mientras nadie escale a dos réplicas, y nada lo impide: es una casilla de configuración, no un error de compilación. Cuando alguien la toque, el throttling se romperá **en silencio**, y lo que se verá tres horas más tarde es un cron fallando por 429 sin causa aparente. Dos euros al mes es barato; una invariante que solo vive en la cabeza de quien la escribió, no.

**Porque el ADR 0005 rechazó Postgres con razón, y esa razón ha caducado.** Rechazó una tabla de consumo porque _"hoy el escenario que cubre es 'el cron de 3 peticiones coincide con un muestreo manual'"_. Era cierto: no había web. El escenario que cubre ahora es que cualquier visita pueda llamar a Blizzard, que es exactamente el caso que aquel ADR dijo que traería la conversación de vuelta. Su otra objeción —una escritura en el camino crítico de cada petición— cuesta unos milisegundos frente a una llamada a Blizzard de cientos, y si algún día molesta, la palanca es reservar fichas en lote, no volver a la memoria.

**Porque Netlify sobre Vercel se decide por licencia, no por rendimiento.** §36 contempla monetizar, y el plan gratuito de Vercel prohíbe el uso comercial: el día que el producto ingrese un euro habría que migrar o pagar 20 $ por usuario y mes. El de Netlify no lo prohíbe. Y el operador ya lo usa en otro proyecto, que en un equipo de una persona es una razón legítima y no una comodidad: la infraestructura que no hay que aprender es la que no falla un domingo.

## Consecuencias

- **`RequestQueue` cambia de contrato**: sigue siendo la única puerta a Blizzard, pero deja de ser la autoridad sobre la cuota. Sus tests con reloj inyectable siguen valiendo para el espaciado y el orden; el presupuesto horario pasa a probarse contra la tabla.
- **`BLIZZARD_REQUESTS_PER_HOUR` cambia de significado.** Su default de 24.000 sobre 36.000 existía porque los procesos no se veían entre ellos. Ahora se ven, así que el margen puede estrecharse — pero no cerrarse: fuera del bucket siguen quedando las peticiones de OAuth y cualquier `fetch` que no pase por el cliente.
- **Aparece un modo de fallo que no existía: con la base de datos caída, el pipeline se queda sin permiso para llamar a Blizzard.** Antes eran independientes. Es el precio de tener una sola cuenta, y es preferible a la alternativa, que es gastar cuota a ciegas.
- **`packages/core` no se entera, pero `apps/pipeline` queda expuesto a la web.** Hoy `BlizzardClient` y `lookupCharacter()` viven en el pipeline, y la web tendría que importarlos cruzando apps, algo que el [ADR 0001](0001-estructura-del-repo-y-stack.md) no previó. Dónde acaba viviendo ese código compartido es de [#61](https://github.com/Atorey/wow-pvp-intelligence/issues/61) y [#62](https://github.com/Atorey/wow-pvp-intelligence/issues/62); esta decisión solo dice que el permiso de cuota viaja con él.
- **[#71](https://github.com/Atorey/wow-pvp-intelligence/issues/71) recibe la mitad de su respuesta y hereda la otra mitad.** El colchón reservado de la decisión 5 hace que un bot no pueda dejar al pipeline sin cuota: el daño queda acotado a la reserva. Lo que sigue siendo suyo es el límite por IP, la caché de negativos y qué se le enseña al jugador cuando se toca el techo.
- **[#66](https://github.com/Atorey/wow-pvp-intelligence/issues/66) es el momento en que esto empieza a decidir de verdad.** Hoy la contención es teórica: el batch gasta 3-4 peticiones cada 3 horas. Con ingesta continua de perfiles habrá un consumidor sostenido de decenas de miles de peticiones por hora compitiendo con la web, y ahí el colchón pasa de precaución a mecanismo activo. Conviene volver a este ADR con esa medición delante, no antes.
- **Los 10 segundos de Netlify son una restricción real, no holgura.** Un lookup son 4 peticiones más una por bracket ([ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md)): unos 3-4 s para un jugador de dos specs. Un solo 429 con `Retry-After` de 5 s se lleva el presupuesto entero. Por eso la decisión 7 acota el tiempo en vez de confiar en que quepa.
- **El plan gratuito de Netlify tiene un techo que se agota deployando, no solo sirviendo**: 300 créditos al mes, 15 por deploy a producción, y al agotarlos el sitio se pausa hasta el mes siguiente sin opción de exceso. En desarrollo activo eso muerde antes que el tráfico.
- **Las peticiones a `oauth.battle.net` se cuentan contra el bucket, aunque no se sepa si Blizzard las cuenta.** _(añadido el 1 de septiembre de 2026, al implementar esto en [#81](https://github.com/Atorey/wow-pvp-intelligence/issues/81))_ La decisión 8 dejaba abierto si el endpoint de token, que está en otro host, consume de los 36.000/h del client ID. No hay respuesta pública —ni en la documentación de `develop.battle.net` ni en los hilos de rate limits del foro oficial— y medirlo exigiría quemar unas 36.000 peticiones controladas para ver dónde aparece el 429. Así que la pregunta se cierra por el lado barato: `getAccessToken()` pide ficha al bucket como cualquier otra petición. Con el token compartido en la tabla eso es ~1 petición al día en el pipeline y ninguna en la mayoría de invocaciones en frío, así que si cuentan están contadas y si no cuentan hemos gastado una ficha diaria. Lo que no se hace es dejarlas fuera y confiar: sería la única excepción a la decisión 3, y el valor de esa decisión es que no las haya.

- **Queda sin decidir aquí, y a propósito, dónde corre `sample-profiles`.** Sigue siendo un comando manual. Cuando #66 lo convierta en continuo necesitará un runner, y esa es una decisión de la fila "Jobs" de §29 que este ADR no prejuzga.
