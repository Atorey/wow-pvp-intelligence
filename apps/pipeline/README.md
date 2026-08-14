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

**Coste.** Son 4 peticiones por personaje (perfil, bracket de PvP, equipo, talentos). El default son ~2.400 peticiones, unos 5 minutos. Un censo de los dos buckets ronda las 22.000-32.000 y se come la mayor parte del límite horario (36.000 req/h), así que conviene lanzarlo sabiendo que esa hora no queda cuota para otra cosa.

**Reanudable.** Cada perfil se vuelca a `data/profiles/<runId>/`, y un personaje que ya tiene archivo no se vuelve a pedir. El `captured_at` de todos los snapshots del run es el `sampledAt` del manifiesto, no `now()`: reanudar o repetir el run no duplica población.

**La muestra se congela al elegirla**, en `data/profiles/<runId>/sample-<bracket>-<segmento>.json`. No es redundante con que el muestreo sea determinista: el job escribe snapshots de perfil, y el rating del perfil puede no coincidir con el que traía el leaderboard, así que un personaje puede cambiar de segmento y salir del bucket. Si la muestra se recalculase en cada pasada, la población habría cambiado bajo los pies del propio job y saldrían personajes distintos — gastando cuota otra vez y rompiendo la reproducibilidad. La muestra es un hecho del run, como su `captured_at`.

**Muestreo aleatorio, no "los N primeros".** Coger la cabeza del ranking sesgaría el bucket hacia su parte alta, y ese sesgo acabaría en cualquier `adoption_rate` calculado después. Es reproducible por semilla para que un hallazgo se pueda auditar.

Si un bucket tiene menos personajes que el tope —el caso de Frost Mage en 1800-2000, donde el corte del top 5.000 cae justo ahí— se muestrea lo que haya y se declara el `n` real con su confianza. El hueco es el hallazgo, no un fallo que haya que rellenar bajando el listón.

El reporte queda en `reports/profile-sample-<runId>.json`, con la cobertura de talentos **por clase**: es lo que decide si Player Gap puede prometer talentos o se queda en gear.

### `migrate`

Aplica las migraciones pendientes de `db/migrations/`. Ver [db/README.md](../../db/README.md).

## Cómo añadir un job nuevo

1. Un archivo en `src/jobs/`, exportando una función `async` que recibe los argumentos del CLI (`string[]`) y los ignora si no los necesita.
2. Registrarlo en `src/cli.ts`.
3. **Siempre a través de `BlizzardClient`**, nunca con `fetch` directo: es el único sitio donde se controla el ritmo de peticiones, y saltárselo rompe el throttling global (límite: 100 req/s, 36.000 req/h por client ID).
