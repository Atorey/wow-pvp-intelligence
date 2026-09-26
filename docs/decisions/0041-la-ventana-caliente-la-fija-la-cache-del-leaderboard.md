# ADR 0041 — La ventana caliente de `character_snapshots` la fija la caché del leaderboard, no la de agregación

**Fecha**: 26 de septiembre de 2026 · **Estado**: aceptada (issue #132; revisa el punto 1 del [ADR 0034](0034-historico-frio-archivado-en-storage.md))

## Contexto

El ADR 0034 dejó en Postgres los últimos **14 días** de `character_snapshots` porque es la ventana de actividad más larga con la que se agrega (`ACTIVITY_WINDOWS.fallback`), y `archive-snapshots` se niega a bajar de ahí. En el mismo ADR decidió que, fuera de esa ventana, cada serie conserva su ancla por origen, su último gear, sus últimos talentos y su pico.

Medido el 26 de septiembre de 2026: de las 375.000 filas de la temporada 42, **258.331 son de leaderboard dentro de los 14 días**. Con la base 165 MB por encima de la cuota y 2v2 por delante, conviene saber si esas filas las lee alguien.

## Lo que se comprobó

Se revisaron todas las lecturas de `character_snapshots`:

- **`refresh-aggregates`** (población activa, perfiles, solo-búsqueda), **`refresh-profiles`** (candidatos y perfiles frescos) y `resolveSeason` filtran por `captured_at >= corte de la ventana de agregación`, pero de cada serie solo se quedan con **la última fila de cada origen** (`distinct on … order by captured_at desc`, `max(captured_at)`, `bool_and(source = 'search')`). Esa fila siempre sigue en Postgres: o es caliente o es el ancla de su origen. Con cualquier ventana de archivado, el resultado es el mismo.
- **`refresh-activity`** no recorta por ventana: lee la serie caliente y hereda lo archivado de su propia fila, a partir del ancla (ADR 0034, punto 4).
- **La ficha** lee la última fila por bracket, el pico, el último gear y los últimos talentos (todos conservados), y el histórico une Postgres con el índice de Storage ([ADR 0039](0039-el-historico-de-rating-se-lee-de-un-indice-en-storage.md)), que recibe cada fila antes de que se borre.
- **La ingesta por cambio** ([ADR 0009](0009-ingesta-por-cambio-de-poblacion.md)) compara con el ancla.

Nada necesita catorce días de filas crudas. Sí hay algo que pone un suelo, y no es la agregación: **la caché de JSON del leaderboard** (`LEADERBOARD_RETENTION_DAYS`, 3 días). Mientras un fichero siga en ella se puede reingerir, y lo que evita que eso duplique observaciones es el índice único `(personaje, bracket, captured_at)`, que solo ve lo que sigue en Postgres.

## Decisión

1. **`archive-snapshots` deja en Postgres 3 días**, no 14.
2. **El mínimo es la caché de JSON del leaderboard**: el job se niega a archivar con menos días que `LEADERBOARD_RETENTION_DAYS`, y si la caché se alarga, el valor por defecto se alarga con ella.
3. **Lo demás del ADR 0034 no cambia**: se conservan el ancla, el último gear, los últimos talentos y el pico; solo se archiva lo que la actividad ya vio; se indexa el rating antes de borrar, y se sube antes de borrar.

## Por qué no las alternativas

- **Dejar 14 días.** Cuesta unos 60-70 MB (estimación: unas 175.000 filas a ~410 bytes con sus índices) que no lee nadie.
- **1 día.** Rompería la garantía de la caché, y un día de margen no cubre una corrida de agregados fallida. Tres días cuestan poco más.
- **Leer la ventana de agregación desde `character_activity` y no archivar nada caliente.** Es otra forma de decir lo mismo, con más cambios: la agregación ya solo usa la última fila de cada serie.

## Consecuencias

- La primera corrida archiva de golpe lo que hay entre 3 y 14 días: del orden de 200.000 filas en unos diez lotes, y reescribe los shards del índice de rating que toque. Después, cada día archiva lo que entra.
- **El espacio no vuelve solo**: después de esa primera corrida hace falta un `VACUUM FULL character_snapshots` (ver `compact` en el README del pipeline), como tras el primer archivado del ADR 0034.
- La pestaña de histórico va a Storage para casi cualquier ficha, porque casi todas tienen algo archivado. Ya pasaba con 14 días; ahora pasa antes.
- `player-gap --run` sobre un muestreo de más de 3 días deja de encontrar sus snapshots, igual que antes pasaba con los de más de 14.
- **Cualquier lectura nueva que necesite una fila vieja que no sea la última de su serie y origen rompe en silencio.** Es la advertencia de CLAUDE.md, ahora con 3 días en vez de 14: o se añade lo que necesita a lo que se conserva, o sale de una tabla derivada.
