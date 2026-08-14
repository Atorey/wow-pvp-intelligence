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

### `migrate`

Aplica las migraciones pendientes de `db/migrations/`. Ver [db/README.md](../../db/README.md).

## Cómo añadir un job nuevo

1. Un archivo en `src/jobs/`, exportando una función `async` sin argumentos.
2. Registrarlo en `src/cli.ts`.
3. **Siempre a través de `BlizzardClient`**, nunca con `fetch` directo: es el único sitio donde se controla el ritmo de peticiones, y saltárselo rompe el throttling global (límite: 100 req/s, 36.000 req/h por client ID).
