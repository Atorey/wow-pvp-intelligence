# ADR 0004 — El batch de leaderboard corre en GitHub Actions, e ingiere por cambio de contenido

**Fecha**: 16 de agosto de 2026 · **Estado**: aceptada (revisa la fila "Jobs" e "Infra" de §29 del plan)

## Contexto

El plan (§29) previó para los jobs "una cola simple (p. ej. BullMQ sobre Redis) + cron" sobre un proveedor de contenedores (Railway/Render/Fly). Eso describe el destino, no el punto de partida: hoy no hay backend desplegado, ni web, ni Redis, y el único job que necesita cadencia es la descarga del leaderboard de 3 specs — 3 peticiones cada 3 horas.

Levantar un contenedor permanente y una cola para eso es exactamente la sobrearquitectura que el brief prohíbe y que ya recoge el [ADR 0001](0001-estructura-del-repo-y-stack.md).

Hay además un problema que no existía con la ejecución manual de Sprint 0: **preguntamos en nuestro reloj, no en el de Blizzard**. La cadencia de publicación (~3h) es una atribución de terceros que §28 dejó explícitamente "a confirmar". Si el job ingiere todo lo que descarga, cada corrida en la que Blizzard no haya republicado inserta un juego completo de snapshots idénticos con `captured_at` nuevo.

## Decisión

1. **Runner: cron de GitHub Actions** ([.github/workflows/leaderboard.yml](../../.github/workflows/leaderboard.yml)), cada 3 horas, con `workflow_dispatch` para forzar una corrida.
2. **Descarga e ingesta en la misma ejecución**, en un único comando `refresh-leaderboard`. El runner es efímero: un fetch sin su ingesta deja el trabajo en un disco que se destruye al terminar.
3. **La ingesta se decide por contenido, no por reloj.** De cada descarga se guarda el hash del payload de Blizzard en `leaderboard_fetches` (migración 0003). Solo se ingiere cuando el hash difiere del anterior de ese bracket.
4. **Cada descarga queda registrada**, cambie o no, incluso si falló. Los intervalos entre observaciones con `changed = true` miden la cadencia real de publicación.
5. **Los JSON descargados son caché con retención corta** (`LEADERBOARD_RETENTION_DAYS`, 3 días por defecto). El histórico está en Postgres.

## Por qué

**GitHub Actions** porque el coste marginal es cero y la infra ya existe. La cadencia de Blizzard es de horas, así que la falta de puntualidad del cron de Actions (que puede retrasarse minutos) es irrelevante: el punto 3 hace que el job sea correcto llegue cuando llegue.

**Ingerir por cambio de contenido** protege lo único que la API no nos da y que constituye el moat: el histórico. Un `character_snapshots` lleno de repeticiones no es un histórico más denso, es uno más ruidoso — parecerían ocho medidas diarias por personaje cuando en realidad son las mismas tres. Y contamina todo lo que se calcule encima: ventanas de actividad (#16), "last seen" derivado de `season_match_statistics` (§30), trends (#27).

**Registrar también lo que no cambió** porque un hueco en la bitácora es ambiguo: no distingue "Blizzard no publicó" de "el job no corrió" o "la API falló". Sin esa distinción, la cadencia no se puede medir, solo suponer — que es justo lo que llevamos haciendo desde §28.

## Consecuencias

- El número de snapshots ya no crece con la frecuencia del cron, sino con la frecuencia real de publicación de Blizzard. Subir el cron a cada hora no multiplicaría los datos, solo las llamadas: la frecuencia se ajusta sin miedo a inflar la muestra.
- La cadencia de ~3h de §28 pasa a ser comprobable. `refresh-leaderboard` imprime la mediana observada por bracket al final de cada corrida; con dos o tres semanas de bitácora hay dato para confirmar o corregir el cron. **Es una cota superior**: mirando cada 3h no se puede detectar nada más rápido que eso.
- Los secrets (`BLIZZARD_CLIENT_ID`, `BLIZZARD_CLIENT_SECRET`, `DATABASE_URL`) viven en la configuración del repo en GitHub. Es la parte incómoda de esta decisión: la base de datos de producción es alcanzable desde un workflow, así que quien tenga permisos de escritura sobre el repo la alcanza.
- **GitHub desactiva los workflows programados tras 60 días sin actividad en el repo.** Si el proyecto queda parado, el job deja de correr en silencio. Hay que reactivarlo a mano desde la pestaña Actions.
- **Los renombrados dejan de romper la ingesta, y conservan su histórico.** Ingerir dos veces destapó un fallo que la ejecución única de Sprint 0 no podía ver: un personaje renombrado llega con el mismo `blizzard_character_id` bajo otro `(reino, nombre)`, y la fila nueva choca contra `idx_characters_blizzard_id`, abortando la ingesta entera. Fueron 11 casos en 2 días sobre 15.009 personajes, así que a cadencia de 3h es un choque garantizado. `ingest-leaderboard` ahora reconcilia por id de Blizzard antes del upsert: mueve la fila existente en lugar de crear una nueva. Partir el histórico en dos identidades lo rompería justo donde está el valor del producto, y contaría al jugador dos veces en la población — es decir, en el `n` que sostiene la confianza declarada ([ADR 0003](0003-umbrales-de-confianza.md)). Si el nombre nuevo ya lo ocupa otra fila (los nombres se reciclan), la vieja suelta el id en vez de sobrescribir a un tercero.
- `fetch-leaderboard` e `ingest-leaderboard` siguen existiendo por separado para trabajo manual y depuración. `refresh-leaderboard` no los duplica: reutiliza sus funciones.
- Esto **no** cierra la fila "Jobs" de §29. Cuando entren el refresco bajo demanda por búsqueda de usuario (#14) y el throttling con prioridades (#12), la cola con Redis vuelve a la mesa: Actions no sirve para trabajo disparado por un usuario que está esperando. Este ADR cubre solo el batch periódico.
