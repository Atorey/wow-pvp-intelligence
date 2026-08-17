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

Todas las peticiones pasan por una cola compartida por el proceso ([ADR 0005](../../docs/decisions/0005-cola-de-peticiones-con-prioridades.md)) que respeta dos techos a la vez:

| Techo                        | Variable                       | Default | Límite real de Blizzard |
| ---------------------------- | ------------------------------ | ------- | ----------------------- |
| Instantáneo                  | `BLIZZARD_REQUESTS_PER_SECOND` | `8`     | 100 req/s               |
| Horario (ventana deslizante) | `BLIZZARD_REQUESTS_PER_HOUR`   | `24000` | 36.000 req/h            |

El horario es el que muerde: 8 req/s sostenidos son 28.800 peticiones en una hora. El default va por debajo del techo real porque el presupuesto se lleva **por proceso** — dos jobs lanzados a la vez no se ven entre ellos.

**Al agotarse la ventana la cola espera**, no falla, y lo avisa por consola. Un job puede quedarse parado hasta que se libere hueco; el aviso está para que eso no se confunda con un cuelgue.

**Prioridades** (§28 del plan): `on-demand` (refresco por búsqueda de usuario, pendiente de #14) > `batch` (leaderboard) > `aggregate` (`sample-profiles`). Cada job declara la suya al construir el cliente: `new BlizzardClient({ priority: "aggregate" })`. Hoy los jobs son secuenciales y rara vez compiten por un turno; la prioridad empieza a decidir algo cuando exista trabajo disparado por un usuario que está esperando.

Cada job imprime al terminar lo que ha gastado, por prioridad y en porcentaje de la ventana horaria.

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

### `player-gap`

Genera la comparación de un personaje contra el segmento de rating inmediatamente superior (§13 del plan, issue #9). No llama a la API: lee de Postgres lo que `sample-profiles` ya bajó.

```bash
npm run pipeline -- player-gap                                  # un sujeto por spec, en 1800-2000
npm run pipeline -- player-gap --character ravencrest/loode     # un personaje concreto
npm run pipeline -- player-gap --top 10                         # más diferencias en la lista
```

| Opción        | Default         | Qué hace                                                         |
| ------------- | --------------- | ---------------------------------------------------------------- |
| `--run`       | el más reciente | Run muestreado a analizar; fija el `captured_at` de la población |
| `--character` | —               | `reino/nombre`; si se omite, se elige un sujeto por spec         |
| `--top`       | `5`             | Cuántas diferencias de gear se listan                            |
| `--rating`    | `1800`          | Rating de entrada del segmento de los sujetos                    |

Escribe dos archivos por personaje en `reports/`: un `.json` auditable con los denominadores crudos y un `.md` legible. El markdown es el que sirve para la validación cualitativa de §32 ("¿un jugador experto reconocería esto como razonable?").

**El cálculo no está aquí.** Vive en `packages/core/src/player-gap.ts`, con tests, para que la web de Phase 2 (#18) use la misma fórmula en vez de reimplementarla. Este job solo consulta y renderiza.

**Los sujetos se eligen con muestreo reproducible**, no cogiendo el primero de la lista, por lo mismo que en `sample-profiles`: el primero por `character_id` no representa al segmento.

**Segmenta por el rating del snapshot de perfil**, no por el bucket con el que se muestreó. Entre la descarga del leaderboard y la del perfil pasan días y hay quien ha cambiado de segmento; usar el bucket original metería en 1800-2000 a gente que hoy está en 2200.

Lo que la comparación **no** incluye, y cada reporte declara: ventana de actividad (#16), stats secundarias y embellishments (el schema no los guarda), y talentos por nodo (#24 — ver el hallazgo de la sección 6.2 de [sprint-0-findings](../../docs/sprint-0-findings.md), la coincidencia exacta de código no da señal utilizable).

### `migrate`

Aplica las migraciones pendientes de `db/migrations/`. Ver [db/README.md](../../db/README.md).

## Cómo añadir un job nuevo

1. Un archivo en `src/jobs/`, exportando una función `async` que recibe los argumentos del CLI (`string[]`) y los ignora si no los necesita.
2. Registrarlo en `src/cli.ts`.
3. **Siempre a través de `BlizzardClient`**, nunca con `fetch` directo: es el único sitio donde se controla el ritmo de peticiones, y saltárselo rompe el throttling global (límite: 100 req/s, 36.000 req/h por client ID).
4. **Declarando su prioridad** al construir el cliente (ver "Cuota y prioridades"). El default es `batch`; usa `aggregate` si lo que baja alimenta recomputos que nadie está esperando.
