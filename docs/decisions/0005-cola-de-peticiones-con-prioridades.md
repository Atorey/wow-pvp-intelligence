# ADR 0005 — Cola de peticiones con prioridades y presupuesto horario, en proceso

**Fecha**: 17 de agosto de 2026 · **Estado**: aceptada (implementa el "diseño obligatorio" de §28 del plan; no cierra la fila "Jobs" de §29) · **Revisado en parte el 22 de agosto de 2026 por el [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)**: el presupuesto deja de ser por proceso. La cola sigue ordenando y espaciando dentro de cada uno

## Contexto

§28 exige "cola con throttling explícito (no confiar en reintentos reactivos tras 429), y priorización: refresco bajo demanda de usuario > batch de leaderboard > recomputo de agregados". §30 fija el límite: **100 req/s y 36.000 req/h por client ID**.

Lo que había cubría la mitad. El `RateLimiter` ya espaciaba los turnos a ritmo fijo por diseño —eso sí era throttling explícito, no reactivo— pero solo controlaba el techo **instantáneo**. Faltaban las dos cosas que dan nombre al issue #12:

- **El techo horario no existía como código.** Se cumplía por casualidad de configuración: 8 req/s por defecto son 28.800 peticiones en una hora, que caben en 36.000. Subir `BLIZZARD_REQUESTS_PER_SECOND` a 12 para acelerar un censo habría agotado la cuota sin que nada lo impidiera ni lo avisara. Y es el techo que muerde: el instantáneo (100 req/s) está a 12 veces de nuestro ritmo real.
- **No había prioridad de ningún tipo.** Cada llamante reservaba su turno por su cuenta, así que el orden lo decidía el momento de llegada y nada más.

El contexto que condiciona la decisión: no hay web ni API desplegada (entra en Phase 2), cada job es un proceso CLI de un solo uso y el runner del batch es efímero ([ADR 0004](0004-job-programado-del-leaderboard.md)). El consumidor de la prioridad más alta —el refresco bajo demanda por búsqueda de usuario (#14)— **todavía no existe**.

## Decisión

1. **`RequestQueue` en proceso** ([apps/pipeline/src/blizzard/request-queue.ts](../../apps/pipeline/src/blizzard/request-queue.ts), antes `rate-limiter.ts`), sin infraestructura nueva. Un único bucle reparte los turnos en vez de que cada llamante espere el suyo: es lo que hace posible ordenar, porque cuando llega el turno se elige al mejor candidato **de los que hay en ese momento**, no al que reservó primero.
2. **Dos techos a la vez**: espaciado fijo por segundo, y ventana deslizante horaria sobre las peticiones ya concedidas.
3. **Las tres prioridades de §28**, una por job: `on-demand` (reservada para #14) > `batch` (leaderboard) > `aggregate` (`sample-profiles`, que alimenta los agregados de población).
4. **Una cola por proceso, compartida por todos los `BlizzardClient`.** El límite de Blizzard es por client ID: dos clientes con su propia cola se repartirían el doble de cuota de la que existe.
5. ~~**El presupuesto es por proceso, con margen**~~: 24.000 req/h por defecto sobre un techo real de 36.000 (`BLIZZARD_REQUESTS_PER_HOUR`). **Revisado el 22 de agosto de 2026 por el [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)**: con la web sirviéndose desde funciones efímeras, un presupuesto que no sobrevive al proceso se multiplica por el número de invocaciones. La cuenta pasa a una tabla de Postgres que todos comparten, y `BLIZZARD_REQUESTS_PER_HOUR` deja de ser un margen para ser el techo global.
6. **Al agotar la ventana, la cola espera** a que se libere, y lo avisa por consola.
7. **Un 429 con `Retry-After` pausa la cola entera**, también lo urgente. El que ha pedido esperar es Blizzard; colarse solo gastaría cuota en otro 429.
8. **Cada job imprime su gasto al terminar** (peticiones por prioridad, % de la ventana horaria, esperas por cuota).

## Por qué

**En proceso y sin Redis**, aunque §29 mencione BullMQ para jobs. Una cola persistente coordina procesos distintos, y hoy no hay procesos distintos que coordinar: son ejecuciones CLI secuenciales y un cron en Actions. Levantar Redis para eso es la sobrearquitectura que el brief prohíbe, la misma razón por la que el ADR 0004 no lo hizo. Cuando #14 traiga un backend con usuarios esperando, la conversación vuelve — y entonces habrá algo real que coordinar.

**Presupuesto por proceso y no persistido en Postgres.** La alternativa honesta era una tabla de consumo que todos los procesos leyeran: daría un techo de 36.000/h exacto aunque hubiera jobs solapados. Cuesta una migración y una escritura en el camino crítico de **cada petición**, y hoy el escenario que cubre es "el cron de 3 peticiones coincide con un muestreo manual". El margen del default cubre ese caso por bastante menos.

**Esperar en vez de fallar** cuando se agota la cuota, porque los dos jobs caros ya son reanudables y su valor está en terminar, no en terminar pronto: `sample-profiles` congela su muestra y su `captured_at` en el manifiesto, así que esperar una ventana no cambia el dato que produce. El que sí corre en Actions (`refresh-leaderboard`) gasta 3-4 peticiones por corrida y nunca va a tocar el techo, así que la espera no puede quemar minutos de runner.

## Consecuencias

- **La prioridad hoy no cambia nada observable**, y conviene decirlo sin adornos: todos los jobs son secuenciales, así que casi nunca hay dos candidatos compitiendo por un turno. Es superficie preparada y probada (con reloj inyectable) para #14, que es donde empezará a decidir algo de verdad.
- **El presupuesto por proceso es una aproximación.** Dos jobs lanzados a la vez pueden sumar 48.000 req/h si alguien sube el límite por `.env`; el margen del default es lo único que lo evita. Si el proyecto llega a tener varios procesos concurrentes de forma habitual, esto necesita un ADR nuevo, no un ajuste de variable. **Llegó a serlo con la web (issue #60), y ese ADR es el [0013](0013-web-serverless-y-cuota-en-postgres.md).**
- **Un censo de `sample-profiles` (22.000-32.000 peticiones) puede quedarse esperando** hasta que la ventana se libere, y por tanto durar más de una hora en vez de agotar la cuota y dejar al resto del sistema sin nada. Es el intercambio buscado, pero hay que lanzarlo sabiéndolo: el aviso por consola existe para que un job parado no se confunda con uno colgado.
- **Riesgo de inanición asumido**: un flujo sostenido de peticiones `on-demand` podría dejar sin turno a los agregados. A los volúmenes del MVP no es un escenario real; si llega a serlo, la respuesta es una reserva mínima de cuota por prioridad, no subir el techo.
- **Los reintentos consumen presupuesto**, porque consumen cuota real. Un `tryGet` con 3 reintentos cuenta 4 peticiones.
- Esto **no** cierra la fila "Jobs" de §29 ni sustituye a un planificador: la cola ordena peticiones a Blizzard dentro de un proceso, no ejecuta trabajos ni sobrevive al proceso.
