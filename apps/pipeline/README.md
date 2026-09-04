# Pipeline

Ingesta de datos: Blizzard API → Postgres, append-only.

```bash
npm run pipeline -- <comando>     # desde la raíz del repo
```

## Credenciales de Blizzard (una sola vez)

1. Entra en <https://develop.battle.net/access> con tu cuenta de Battle.net.
2. **Create Client**. El nombre puede ser público y único (p. ej. `wow-pvp-intel`).
3. **Redirect URI**: no la usamos (flujo _client credentials_, sin login de usuario), pero el formulario la pide: `https://localhost:8080` sirve.
4. Copia `Client ID` y `Client Secret` en el `.env` de la raíz del repo. Guarda el secret al momento: a veces solo se muestra una vez.

## Cuota y prioridades

El presupuesto de cuota **no vive en el proceso, vive en Postgres** ([ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md)). La tabla `blizzard_quota` guarda dos token buckets y cualquier proceso pide permiso ahí antes de llamar a Blizzard: el pipeline, un job de Actions o una función de Netlify. Es lo que hace la cuenta correcta haya un proceso o cien, que es justo lo que la cuenta en memoria no podía dar en cuanto la web entró en escena.

| Qué                              | Variable                         | Default | Límite real de Blizzard |
| -------------------------------- | -------------------------------- | ------- | ----------------------- |
| Espaciado de **este** proceso    | `BLIZZARD_REQUESTS_PER_SECOND`   | `8`     | —                       |
| Bucket compartido por segundo    | `BLIZZARD_GLOBAL_PER_SECOND`     | `80`    | 100 req/s               |
| Bucket compartido por hora       | `BLIZZARD_REQUESTS_PER_HOUR`     | `32000` | 36.000 req/h            |
| Colchón reservado a `on-demand`  | `BLIZZARD_ON_DEMAND_RESERVE`     | `2000`  | —                       |
| Presupuesto de tiempo del lookup | `BLIZZARD_LOOKUP_TIME_BUDGET_MS` | `8000`  | 10 s de Netlify         |

Los dos números por segundo son cosas distintas: el primero es el ritmo al que un proceso se espacia a sí mismo, el segundo es el techo que comparten todos. Los tres últimos valores **tienen que valer lo mismo en todos los procesos que compartan client ID**: no viven en la tabla, viajan como parámetro, y uno mal configurado rellena el bucket más rápido de lo que debe.

**Token bucket y no ventana horaria**: una ventana fija deja gastar el presupuesto entero al final de una hora y otro entero al principio de la siguiente —48.000 peticiones en sesenta minutos reales— sin que ningún contador proteste.

**Al quedarse sin fichas la cola espera**, no falla, y lo avisa por consola. Un job puede quedarse parado hasta que el bucket se rellene; el aviso está para que eso no se confunda con un cuelgue. Quien tiene a un humano delante no espera: lleva un presupuesto de tiempo y responde con una negativa explícita al agotarlo.

**Prioridades** (§28 del plan): `on-demand` (`lookup-character`, la búsqueda de usuario) > `batch` (leaderboard) > `aggregate` (`sample-profiles`, `refresh-profiles` y `resolve-item-media`). Cada job declara la suya al construir el cliente: `new BlizzardClient({ priority: "aggregate", db: pool })`.

La prioridad hace ahora **dos** cosas. Dentro de un proceso sigue ordenando la cola. Entre procesos es una **reserva**: `on-demand` gasta hasta la última ficha, y `batch` y `aggregate` solo obtienen permiso por encima del colchón. Ordenar no bastaba porque una función efímera no puede esperar su turno en una cola que no ve.

**Todos los comandos que llaman a Blizzard necesitan `DATABASE_URL`**, también `fetch-leaderboard` y `validate-endpoints`, que no escriben nada en la base: el permiso vive ahí y el valor de la decisión es que no haya excepciones. La contrapartida, declarada en el ADR: con la base caída, el pipeline se queda sin permiso para llamar a Blizzard.

El **access token de OAuth** también vive en esa tabla y no en la memoria del proceso. En un proceso encendido cachearlo en el objeto era una petición cada 24 h; en serverless sería una por arranque en frío, y ninguna la contaba nadie. Se pide con ficha del bucket como cualquier otra petición: no está publicado si `oauth.battle.net` cuenta contra los 36.000/h, y contarla cierra la duda por el lado barato (~1 al día).

La búsqueda bajo demanda añade una variable propia, `CHARACTER_LOOKUP_TTL_MINUTES` (30 por defecto): ver `lookup-character`.

Cada job imprime al terminar lo que ha gastado, por prioridad, y cuántas fichas quedaban en el bucket compartido.

## Comandos

### `validate-endpoints`

Comprueba los 4 endpoints core contra los personajes de [config/characters.eu.json](config/characters.eu.json) y agrupa el resultado de talentos **por clase**.

Esa agrupación es el punto: `talent_loadout_code` se reportó ausente tras el parche 11.2 de forma desigual según la clase, así que un 100% sobre 3 clases no dice nada sobre las otras 10. Añade personajes hasta cubrir las 13 clases antes de dar el dato por bueno.

El `realmSlug` es el reino en minúsculas y con guiones: "Twisting Nether" → `twisting-nether`.

### `fetch-leaderboard`

Descarga el leaderboard de Solo Shuffle (tope de 5.000 por spec que expone la API) para las specs de [src/specs-to-ingest.ts](src/specs-to-ingest.ts), y lo guarda en `data/leaderboard/` con la marca de tiempo de la descarga.

Si una spec devuelve **0 entradas con respuesta OK**, no asumas que nadie la juega: es un fallo documentado del endpoint para ciertos brackets de shuffle. Reintenta antes de descartarla.

### `ingest-leaderboard`

Carga en Postgres lo descargado e imprime la distribución de población por segmento con su nivel de confianza.

Es **idempotente**: el `captured_at` sale del momento de la descarga, no de `now()`, así que reingerir el mismo archivo no duplica población. Esto importa más de lo que parece — duplicar filas infla el tamaño de muestra y con él la confianza que el producto declara.

### `refresh-leaderboard`

El job programado: `fetch-leaderboard` + `ingest-leaderboard` en una sola ejecución. Es lo que corre cada 3 horas en [.github/workflows/leaderboard.yml](../../.github/workflows/leaderboard.yml) — ver [ADR 0004](../../docs/decisions/0004-job-programado-del-leaderboard.md) para el porqué del runner y del diseño.

**Ingiere solo si Blizzard ha republicado.** De cada descarga se guarda el hash del payload en `leaderboard_fetches`; si coincide con el de la corrida anterior, no se ingiere y el archivo se borra. Sin esto, cada corrida en la que la fuente no ha cambiado insertaría una copia entera de la población con `captured_at` nuevo, y el histórico —que es el moat— pasaría a estar lleno de medidas que no midieron nada.

**Cada descarga queda registrada**, cambie o no, y también si falló: un hueco en la bitácora no distingue "Blizzard no publicó" de "el job no corrió". Al final de cada corrida imprime la cadencia observada por bracket, que es lo que va a confirmar (o corregir) el "~3h aprox., a confirmar" de §28 del plan. Ojo: es una **cota superior**, porque mirando cada 3h no se puede detectar nada más rápido.

**Los JSON de `data/leaderboard/` son caché**, no histórico: se borran pasados `LEADERBOARD_RETENTION_DAYS` días (3 por defecto). El histórico está en Postgres, que es append-only.

Para ejecutarlo en GitHub Actions hacen falta tres secrets en el repo (`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `DATABASE_URL`) y, opcionalmente, la variable `BLIZZARD_REGION`.

### `lookup-character`

```bash
npm run pipeline -- lookup-character --character twisting-nether/anatorey
npm run pipeline -- lookup-character --character ragnaros/alice --character sanguino/bob
npm run pipeline -- lookup-character --character ragnaros/alice --force   # ignora la caché
```

Busca un personaje y lo **añade a la población acumulada** con `source='search'`: identidad, rating de cada Solo Shuffle que juegue, gear y talentos. Es la segunda vía de población de §12 del plan y el motor que consumirá la búsqueda de la web (#19) — ver [ADR 0006](../../docs/decisions/0006-acumulacion-de-poblacion-por-busqueda.md).

**Existe porque el leaderboard no llega abajo.** El tope de 5.000 por spec deja fuera el rango bajo del ICP en las specs más jugadas (Frost Mage no baja de ~1800): un jugador de 1600 solo entra en nuestra base si alguien lo busca.

**Cuesta 4 peticiones más una por bracket jugado.** Los brackets salen del `pvp-summary` del propio personaje, no se prueban las 40 specs a ver cuál responde.

**Caché de `CHARACTER_LOOKUP_TTL_MINUTES` minutos** (30 por defecto), medida sobre la última captura de perfil que tengamos de él. Dentro del TTL no se llama a Blizzard: además de cuota, evita que cinco búsquedas seguidas metan cinco snapshots casi idénticos en un histórico que está para medir cambios.

**El gear se le cuelga solo al bracket de la spec que lleva equipada.** La API devuelve un único equipo, el de ahora; atribuírselo también a las otras specs que juega sería registrar una build que nadie ha observado y que acabaría contando en el `adoption_rate` de un segmento.

**Solo Solo Shuffle.** 2v2/3v3/RBG no nombran ninguna spec y `class_slug`/`spec_slug` se deducen del bracket; entran con #34.

**Cada búsqueda queda registrada** en `character_lookups`, incluidas las que dan 404 o se sirven de caché. Es lo que permite responder a "¿cuánta población nueva aporta de verdad la búsqueda?", que §12 da por hecho y nadie ha medido.

### `sample-profiles`

Baja el perfil completo (gear por slot + `talent_loadout_code`) de una muestra de cada segmento de rating, y lo guarda como snapshots con `source='profile'`. El leaderboard solo trae rating; esto es lo que hace posible comparar algo en Player Gap.

```bash
npm run pipeline -- sample-profiles                      # 100 por bucket en 1800-2000 y 2000-2200
npm run pipeline -- sample-profiles --limit 5            # tirada corta de prueba
npm run pipeline -- sample-profiles --limit 0            # censo del bucket (ver aviso de coste)
npm run pipeline -- sample-profiles --run run-20260814T…  # reanuda un run cortado
```

| Opción       | Default     | Qué hace                                                                |
| ------------ | ----------- | ----------------------------------------------------------------------- |
| `--limit`    | `100`       | Personajes por bucket. `0` = censo, sin tope                            |
| `--segments` | `1800,2000` | Rating de entrada de cada segmento; los límites los pone `segmentFor()` |
| `--seed`     | constante   | Semilla del muestreo: misma semilla = misma muestra                     |
| `--run`      | —           | Reanuda un run existente reusando sus parámetros y su `captured_at`     |

Requiere haber ejecutado antes `fetch-leaderboard` e `ingest-leaderboard`: los candidatos salen de la población ya en Postgres.

**Coste.** Son 4 peticiones por personaje (perfil, bracket de PvP, equipo, talentos). El default son ~2.400 peticiones, unos 5 minutos. Un censo de los dos buckets ronda las 22.000-32.000: pasa del presupuesto horario por defecto, así que la cola lo frenará hasta que la ventana se libere en vez de agotar la cuota del client ID. Cuenta con que dure más de una hora, y con que durante ese rato el resto de jobs compitan por los mismos turnos.

**Reanudable.** Cada perfil se vuelca a `data/profiles/<runId>/`, y un personaje que ya tiene archivo no se vuelve a pedir. El `captured_at` de todos los snapshots del run es el `sampledAt` del manifiesto, no `now()`: reanudar o repetir el run no duplica población.

**La muestra se congela al elegirla**, en `data/profiles/<runId>/sample-<bracket>-<segmento>.json`. No es redundante con que el muestreo sea determinista: el job escribe snapshots de perfil, y el rating del perfil puede no coincidir con el que traía el leaderboard, así que un personaje puede cambiar de segmento y salir del bucket. Si la muestra se recalculase en cada pasada, la población habría cambiado bajo los pies del propio job y saldrían personajes distintos — gastando cuota otra vez y rompiendo la reproducibilidad. La muestra es un hecho del run, como su `captured_at`.

**Muestreo aleatorio, no "los N primeros".** Coger la cabeza del ranking sesgaría el bucket hacia su parte alta, y ese sesgo acabaría en cualquier `adoption_rate` calculado después. Es reproducible por semilla para que un hallazgo se pueda auditar.

Si un bucket tiene menos personajes que el tope —el caso de Frost Mage en 1800-2000, donde el corte del top 5.000 cae justo ahí— se muestrea lo que haya y se declara el `n` real con su confianza. El hueco es el hallazgo, no un fallo que haya que rellenar bajando el listón.

El reporte queda en `reports/profile-sample-<runId>.json`, con la cobertura de talentos **por clase**: es lo que decide si Player Gap puede prometer talentos o se queda en gear.

### `refresh-profiles`

Mantiene fresca la **base de comparación**: baja perfiles por par `(bracket, segmento)` hasta el objetivo de confianza, dentro de la ventana de actividad y de la temporada vigente. Es lo que hace que `gear_sample` no sea cero, y por tanto lo que hace que Player Gap pueda pintar algo. Corre a diario en [.github/workflows/profiles.yml](../../.github/workflows/profiles.yml) — ver [ADR 0021](../../docs/decisions/0021-ingesta-continua-de-perfiles.md) y el contrato del [ADR 0010](../../docs/decisions/0010-cobertura-por-segmento.md).

```bash
npm run pipeline -- refresh-profiles --dry-run              # planifica e imprime, sin gastar nada
npm run pipeline -- refresh-profiles                        # corrida normal, con el presupuesto por defecto
npm run pipeline -- refresh-profiles --budget 20000         # una puesta al día más agresiva
npm run pipeline -- refresh-profiles --specs frost-mage     # acotado a una spec
```

| Opción       | Default                  | Qué hace                                                         |
| ------------ | ------------------------ | ---------------------------------------------------------------- |
| `--budget`   | `PROFILE_REFRESH_BUDGET` | Techo de peticiones de la corrida; el plan se recorta para caber |
| `--dry-run`  | —                        | Planifica e imprime, sin llamar a Blizzard ni escribir           |
| `--window`   | la de cada par           | Fuerza la ventana de actividad: `7` o `14`                       |
| `--specs`    | todas                    | Acota la corrida a estas specs                                   |
| `--segments` | todos                    | Acota a los segmentos objetivo con este rating de entrada        |
| `--seed`     | constante                | Semilla del muestreo dentro de cada par                          |

**No es `sample-profiles` en bucle.** Aquel congela una muestra en disco para que un hallazgo se pueda auditar; este recalcula en cada corrida quién ha caducado. Comparten las cuatro llamadas y la escritura del snapshot (`profile-capture.ts`), no el estado.

**El presupuesto se gasta primero en el suelo y después en el objetivo.** Se llevan todos los pares que puedan a `MIN_SAMPLE_MEDIUM` (30) antes de subir ninguno hacia `MIN_SAMPLE_HIGH` (100): el mínimo de lanzamiento se cuenta en **pares servibles**, así que muchos pares en `medium` valen más que unos pocos en `high` y el resto sin comparación. El umbral no se toca — sigue decidiéndolo `confidenceFor()`.

**El orden entre pares es el del ADR 0010**: el ICP (1400-2200) entero antes que nada de fuera y, dentro de cada ámbito, más sujetos debajo primero. Un segmento objetivo sin población debajo no se muestrea, por muy poblado que esté: su gear no le serviría a nadie.

Las dos mitades hacen falta. Ordenando solo por sujetos debajo, el presupuesto se va al **fondo de la ladder**: al empezar una temporada todo el mundo pasa por 200-600, así que ahí es donde más población hay y no le sirve a ningún jugador del público objetivo. Qué pares son del ICP lo decide `servesIcpSubjects()` por quién hay **debajo** del segmento objetivo, no por su propio rating.

**La ventana la elige cada par**, con la misma función que el agregado (`pickActivityWindow`), y decide dos cosas a la vez: quién es candidato y qué perfil sigue contando como fresco. Muestrear con una ventana más estrecha que la del agregado sesgaría el gear del segmento hacia sus jugadores más activos sin que ningún número lo delatara.

**Sin estado propio.** Qué falta por bajar se deriva de la población activa cruzada con el último perfil de cada personaje. No hay manifiesto ni tabla de progreso que pueda desincronizarse de lo que publica el agregado — y por eso el job funciona igual en un runner efímero.

El plan se imprime siempre antes de gastar: cuántos pares suben, cuántos se quedan cortos por presupuesto y cuántos no llegan al suelo porque no hay tanta gente activa. Ese último número es cobertura real, no un fallo.

### `refresh-activity`

Recalcula `last_active_snapshot_date` de cada personaje y bracket a partir de la variación de `season_match_statistics.played`, y lo materializa en `character_activity` (§27 "Active Players", issue #16). No llama a la API. Ver [ADR 0008](../../docs/decisions/0008-ventana-de-actividad-por-partidas-jugadas.md).

```bash
npm run pipeline -- refresh-activity                # temporada vigente
npm run pipeline -- refresh-activity --season 41    # una temporada concreta
npm run pipeline -- refresh-activity --dry-run      # calcula e imprime, sin escribir
```

| Opción      | Default     | Qué hace                                                     |
| ----------- | ----------- | ------------------------------------------------------------ |
| `--season`  | la más alta | Temporada a recalcular (el contador se reinicia en cada una) |
| `--dry-run` | —           | Calcula e imprime el resumen, pero no escribe                |

No hace falta ejecutarlo a mano antes de agregar: **`refresh-aggregates` lo llama al empezar su corrida**, porque filtrar con la actividad de ayer sería decir que se filtra por actividad sin hacerlo.

**Dos niveles de evidencia, y la diferencia importa:**

- `played-delta` — le hemos visto subir el contador entre dos observaciones: sabemos que jugó y cuándo.
- `first-seen` — nunca se le ha visto subirlo. Lo único demostrable es que jugó **antes** de nuestra primera observación (para entrar al ladder hay que jugar), así que se fecha ahí. Es la cota más antigua defendible y **caduca sola**: quien no vuelve a dar señales sale de la ventana de 7 días una semana después.

Hoy el 100% de la población entra por `first-seen` (ladder de la temporada 41 congelado, temporada 42 recién empezada). El job lo dice al terminar y cada segmento guarda su reparto en `active_by_delta` / `active_by_first_seen`.

**Los contadores de fuentes distintas no se restan entre sí.** El perfil devuelve un número sistemáticamente menor que el leaderboard para el mismo personaje y bracket (595 de 595 casos medidos), así que cada fuente se compara consigo misma; `search` comparte listón con `profile` porque sale del mismo endpoint. Sin esa separación aparecían 594 "activos" que no habían jugado nada.

### `refresh-aggregates`

Recalcula la distribución de población y el `adoption_rate` por segmento, y los escribe en `population_segments` / `aggregate_snapshots` (§27 y §28 del plan, issue #15). No llama a la API: solo lee `character_snapshots` y escribe agregados, así que no gasta cuota. Es lo que corre a diario en [.github/workflows/aggregates.yml](../../.github/workflows/aggregates.yml) — ver [ADR 0007](../../docs/decisions/0007-agregados-por-segmento.md).

```bash
npm run pipeline -- refresh-aggregates              # ventana elegida por segmento
npm run pipeline -- refresh-aggregates --dry-run    # calcula e imprime, sin escribir
npm run pipeline -- refresh-aggregates --window 30  # fuerza la ventana de "season active"
```

| Opción      | Default      | Qué hace                                                      |
| ----------- | ------------ | ------------------------------------------------------------- |
| `--window`  | por segmento | Fuerza la ventana de actividad: `7`, `14` o `30` (las de §27) |
| `--dry-run` | —            | Calcula e imprime la tabla, pero no escribe ninguna fila      |

**Cada corrida inserta filas nuevas con su `computed_at`**, nunca actualiza las anteriores: el histórico de agregados es lo que alimentará las tendencias de #27. Son las únicas tablas **derivadas** del proyecto — se reconstruyen enteras volviendo a ejecutar el job, a diferencia de `character_snapshots`.

**La ventana de actividad se elige por segmento**, no por bracket: 7 días si llegan a n=30, si no 14 (§13.4), y queda escrita en `activity_window_days`. Un mismo bracket puede tener 7 días abajo y 14 arriba, y eso es correcto: forzar la misma a los dos significaría perder frescura abajo o muestra arriba.

**"Activo" significa haber dado señal de actividad**, no haber salido en el ladder: la población se cruza contra `character_activity` (ver `refresh-activity`), que el job recalcula al empezar. Quien no tiene fila de actividad no entra — sin serie no se puede afirmar que alguien haya jugado. Cada fila declara además cuánta de su población entró por subida vista del contador y cuánta por primera observación.

**El rating es reciente y el gear puede no serlo.** El rating sale del último snapshot (normalmente de leaderboard, de hoy) y el gear del último perfil completo dentro de la ventana (de `sample-profiles`, de hace días). La distancia entre ambos queda registrada en `profile_data_from` / `profile_data_to` en vez de dejarse suponer.

**Se guarda también lo que no se puede enseñar**: segmentos con n insuficiente e items que lleva una sola persona. Guardar no es mostrar —la puerta sigue siendo `canShowComparison()`— y sin esas filas no se puede saber cuánto le falta a una spec de tanque para llegar a n=30 ni calcular el poder discriminante de §13.3.

**Los personajes que solo vienen de búsquedas (`source='search'`) no entran** en el agregado, pero se cuentan en `excluded_search`. Entran por sesgo de selección (ADR 0006) y meterlos contaminaría el `n` que sostiene la confianza; el contador está para revisar esa decisión con dato delante, porque el precio es dejar 1400-1800 sin agregados.

**Sin perfiles dentro de la ventana solo se publica la distribución.** El job lo avisa al terminar. La solución es muestrear con la cadencia de la ventana —eso es `refresh-profiles`— y no ensanchar la ventana.

### `resolve-item-media`

Rellena el catálogo `item_media`: la URL del icono de cada item observado en el gear equipado y en sus gemas (issue #67, [ADR 0022](../../docs/decisions/0022-catalogo-de-iconos-de-item.md)). Una petición por item a `/data/wow/media/item/{id}`, en prioridad `aggregate`.

```bash
npm run pipeline -- resolve-item-media --dry-run       # cuenta lo pendiente, sin gastar nada
npm run pipeline -- resolve-item-media                 # corrida normal
npm run pipeline -- resolve-item-media --budget 10000  # la primera corrida, que paga el catálogo entero
npm run pipeline -- resolve-item-media --ttl 0         # revalida todas las filas, no solo las caducadas
```

| Opción      | Default | Qué hace                                                             |
| ----------- | ------- | -------------------------------------------------------------------- |
| `--budget`  | `3000`  | Techo de peticiones de la corrida. Una petición = un item            |
| `--ttl`     | `30`    | Días tras los que una fila se vuelve a preguntar. `0` revalida todas |
| `--dry-run` | —       | Cuenta lo pendiente e imprime, sin llamar a Blizzard ni escribir     |

**Se guarda la URL, nunca el archivo.** El icono se sirve desde el CDN de Blizzard porque el PNG es Material suyo bajo licencia de uso personal, y re-alojarlo sería ponerlo a disposición del público ([ADR 0015](../../docs/decisions/0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md), decisión 7). Si esa URL deja de responder, la página se maqueta sin icono; no se copia el archivo.

**Preguntado y sin icono se recuerda; un fallo transitorio no.** Un 404 o un 200 sin asset de icono escriben la fila con `icon_url = null`. Un 500 o una caída de red no escriben nada y el item vuelve a estar pendiente. Sin esa distinción, cada corrida vuelve a gastar cuota en los items que la API no resuelve.

**Las filas caducan a los 30 días** aunque el icono no cambie: la cláusula 2.s de la ToU obliga a refrescar todo Data en ese plazo. Los items nunca preguntados van por delante de los que solo hay que revalidar, así que un presupuesto corto se gasta primero en lo que ninguna página puede pintar.

**Los encantamientos no entran.** El 86% de los observados solo trae `enchantment_id`, y la Game Data API no publica media para eso; la vía de terceros está descartada. Los números están en el [ADR 0022](../../docs/decisions/0022-catalogo-de-iconos-de-item.md).

### `player-gap`

Genera la comparación de un personaje contra el segmento de rating inmediatamente superior (§13 del plan, issue #9). No llama a la API: lee de Postgres lo que `sample-profiles` ya bajó.

```bash
npm run pipeline -- player-gap                                  # un sujeto por spec, en 1800-2000
npm run pipeline -- player-gap --character ravencrest/loode     # un personaje concreto
npm run pipeline -- player-gap --top 10                         # más diferencias en la lista
npm run pipeline -- player-gap --all                            # sin filtro de actividad
```

| Opción        | Default         | Qué hace                                                         |
| ------------- | --------------- | ---------------------------------------------------------------- |
| `--run`       | el más reciente | Run muestreado a analizar; fija el `captured_at` de la población |
| `--character` | —               | `reino/nombre`; si se omite, se elige un sujeto por spec         |
| `--top`       | `5`             | Cuántas diferencias de gear se listan                            |
| `--rating`    | `1800`          | Rating de entrada del segmento de los sujetos                    |
| `--window`    | por segmento    | Fuerza la ventana de actividad: `7`, `14` o `30` (§27)           |
| `--all`       | —               | Sin filtro de actividad; reproduce los reportes anteriores a #16 |

Escribe dos archivos por personaje en `reports/`: un `.json` auditable con los denominadores crudos y un `.md` legible. El markdown es el que sirve para la validación cualitativa de §32 ("¿un jugador experto reconocería esto como razonable?").

**El cálculo no está aquí.** Vive en `packages/core/src/player-gap.ts`, con tests, para que la web de Phase 2 (#18) use la misma fórmula en vez de reimplementarla. Este job solo consulta y renderiza.

**Los sujetos se eligen con muestreo reproducible**, no cogiendo el primero de la lista, por lo mismo que en `sample-profiles`: el primero por `character_id` no representa al segmento.

**Segmenta por el rating del snapshot de perfil**, no por el bucket con el que se muestreó. Entre la descarga del leaderboard y la del perfil pasan días y hay quien ha cambiado de segmento; usar el bucket original metería en 1800-2000 a gente que hoy está en 2200.

**La población se filtra por ventana de actividad** (§27), y la ventana se mide **desde el momento del run**, no desde el reloj de hoy: un reporte tiene que poder reproducirse tal y como se publicó. El sujeto pedido con `--character` no se filtra —es quien pregunta, no parte de la población de referencia—, y `--all` desactiva el filtro entero, avisando en el propio reporte de que sin ventana los porcentajes no describen el meta actual.

Lo que la comparación **no** incluye, y cada reporte declara: stats secundarias y embellishments (el schema no los guarda), y talentos por nodo, que desde el [ADR 0026](../../docs/decisions/0026-talentos-por-nodo.md) sí se agregan por segmento pero todavía no entran en la comparación (#18). La coincidencia exacta de código, que es la que este reporte usa, no da señal utilizable: ver la sección 6.2 de [sprint-0-findings](../../docs/sprint-0-findings.md).

### `seed`

```bash
# una Postgres local, la que sea; esta es la que usa el CI
docker run -d --name wowpvp-dev -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=wowpvp \
  -p 5432:5432 postgres:16-alpine

DATABASE_URL=postgres://postgres:postgres@localhost:5432/wowpvp npm run db:migrate
DATABASE_URL=postgres://postgres:postgres@localhost:5432/wowpvp npm run pipeline -- seed --reset
```

Siembra el dataset de desarrollo: ~600 personajes de dos temporadas repartidos por escalones de rating, con perfiles, gear real y talentos. Es el prerrequisito para trabajar la web sin una copia de producción ni credenciales de Blizzard, y lo decide el [ADR 0018](../../docs/decisions/0018-dataset-de-desarrollo.md).

**Solo escribe en una base local, y no hay flag para saltárselo.** El comando inventa población; en la base real eso falsea los tamaños de muestra sobre los que el producto declara su confianza, y el histórico es append-only.

**No siembra `population_segments` ni `aggregate_snapshots`.** Escribe observaciones y después ejecuta `refresh-aggregates` sobre ellas, igual que en producción. Por eso lo que sale por pantalla al final del comando es el log del job real: si un escalón dice `insufficient`, es porque lo es.

**Los iconos vienen resueltos en el JSON del catálogo**, con su URL real del CDN de Blizzard, y se siembran en `item_media` sin llamar a la API — que es lo que `seed` no puede hacer. Así en local se ve la fila de gear con icono, y el hueco vacío del [brief §4.5](../../docs/design/brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono) se prueba quitando una URL en vez de siendo el único estado posible.

**Misma semilla, mismo dataset**, hasta el último item (`--seed` la cambia). Las fechas sí se anclan al momento de sembrar: `refresh-aggregates` recorta por ventana de actividad contra su propio reloj, así que un dataset con fechas fijas se quedaría sin población en cuanto pasaran dos semanas.

Lo que cubre, y por qué está cada cosa, se imprime al arrancar. En resumen: dos escalones con confianza `high`, uno con población suficiente y gear insuficiente ([#76](https://github.com/Atorey/wow-pvp-intelligence/issues/76)), uno vacío del todo, una spec entera fuera de cobertura, dos temporadas conviviendo y once personajes con nombre fijo que se pueden teclear en una URL —incluidos tres que pliegan al mismo `name_fold` sin ser la misma persona ([ADR 0017](../../docs/decisions/0017-forma-canonica-de-personaje.md))—.

**El dataset es más generoso que la producción de hoy, a propósito.** En la temporada 42 real no hay un solo segmento capaz de pintar un Player Gap ([§13 de findings](../../docs/sprint-0-findings.md)). Desarrollar solo contra los escalones llenos del seed es desarrollar contra un mundo que todavía no existe: los escalones vacíos están ahí para que la pantalla que hoy se ve siempre también se pruebe.

| Opción              | Qué hace                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--reset`           | Vacía las tablas antes de sembrar. Sin esto se suma a lo que hubiera: con la misma semilla añade observaciones a los mismos personajes, con otra añade población nueva. |
| `--seed S`          | Semilla del generador.                                                                                                                                                  |
| `--skip-aggregates` | No encadena `refresh-aggregates` al terminar.                                                                                                                           |

### `migrate`

Aplica las migraciones pendientes de `db/migrations/`. Ver [db/README.md](../../db/README.md).

## Cómo añadir un job nuevo

1. Un archivo en `src/jobs/`, exportando una función `async` que recibe los argumentos del CLI (`string[]`) y los ignora si no los necesita.
2. Registrarlo en `src/cli.ts`.
3. **Siempre a través de `BlizzardClient`**, nunca con `fetch` directo: es el único sitio donde se pide permiso al presupuesto compartido, y lo que no pasa por ahí no lo cuenta nadie — el techo real es 100 req/s y 36.000 req/h por client ID, y quien se lleva los 429 no es siempre quien se pasó.
4. **Pasándole el ejecutor de la base** (`new BlizzardClient({ db: pool })`), el mismo del resto del job: el permiso de cuota vive en Postgres. Un proceso, un ejecutor — construir dos clientes con conexiones distintas falla al arrancar en vez de llevar dos contabilidades del mismo presupuesto.
5. **Declarando su prioridad** al construir el cliente (ver "Cuota y prioridades"). El default es `batch`; usa `aggregate` si lo que baja alimenta recomputos que nadie está esperando.
