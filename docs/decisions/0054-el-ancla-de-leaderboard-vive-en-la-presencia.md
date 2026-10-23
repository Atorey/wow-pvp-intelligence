# ADR 0054 — El ancla de leaderboard vive en la presencia, y se lee de `character_observations`

**Fecha**: 23 de octubre de 2026 · **Estado**: aceptada · **Revisa** el ancla de leaderboard del [ADR 0034](0034-historico-frio-archivado-en-storage.md) · Sigue al [ADR 0053](0053-el-pico-y-los-catalogos-no-retienen-filas.md)

## Contexto

Después de los ADR 0052 y 0053, lo más grande que retiene cada serie en Postgres es su **ancla de leaderboard**: la última fila anterior al corte de la ventana caliente. El 23 de octubre de 2026 había 164.867 filas de leaderboard conservadas fuera de la ventana para 138.182 series. Sin el pico, son unas 135.000 anclas, a ~400 bytes cada una entre heap e índices: **unos 50 MB**, y una más por cada serie nueva.

La leen cuatro sitios, y por eso se conservaba:

- **la ingesta por cambio** (ADR 0009), que compara cada entrada con la observación anterior para no reescribirla;
- **el recálculo de actividad**, que mide la primera subida del contador dentro de la ventana contra ella;
- **los agregados y el muestreo de perfiles**, que leen la última observación de cada serie activa;
- **la ficha, la posición en el bracket y el buscador**, que enseñan lo último que sabemos de alguien aunque sea de hace semanas.

`character_presence` ya tiene una fila por serie, y la ingesta la toca en cada publicación.

## Decisión

1. **`character_presence` guarda una copia exacta del último snapshot de leaderboard de la serie** (migración 0032): rating, puesto, partidas, tier, clase y spec, con su `captured_at` en `changed_at`. La migración la rellena desde las anclas de hoy, y la ingesta la mueve cada vez que escribe una fila de leaderboard. Una entrada redundante no la mueve: su fila sigue siendo la de antes.
2. **La vista `character_observations`** es `character_snapshots` más esa copia cuando ya no está en la tabla (`from_presence`). El `not exists` va por el índice único de captura: mientras el snapshot siga ahí, la vista no añade nada. `latest_snapshot_per_character_bracket` pasa a leer de ella.
3. **Quien lee «la última observación» de una serie lee de la vista**: la ingesta por cambio, el recálculo de actividad, los agregados, el muestreo de perfiles y la ficha (`packages/data/characters.ts`). Lo que solo lee perfiles —gear, talentos, el informe de Player Gap, la búsqueda bajo demanda— sigue en la tabla: el ancla de perfil no cambia.
4. **El recálculo de actividad no cuenta la fila de la presencia en `observations`.** La compara como cualquier otra, pero ya está en `archived_observations`.
5. **El archivado suelta el ancla de leaderboard solo cuando la presencia apunta exactamente a ella**, es decir, cuando `changed_at` es su `captured_at`. Si la serie tiene filas de leaderboard más nuevas en la ventana caliente, la presencia apunta a la más nueva, y el ancla se queda como hasta ahora: es la que mide la primera subida dentro de la ventana, y puede que la actividad aún no la haya comparado.

El punto 5 va en un cambio aparte, que se mergea después de comprobar en producción que la copia coincide con las anclas.

## Por qué

**Porque es una copia exacta, no una aproximación.** La fila de la vista tiene los mismos valores y el mismo instante que el snapshot al que sustituye. Cualquier lectura que con el snapshot daba un resultado da el mismo con la vista. Por eso el cambio es seguro de desplegar en dos pasos: el primero no cambia ninguna respuesta, y el segundo solo cambia dónde está la fila.

**Porque la presencia ya pagaba una fila por serie.** Nueve columnas más en una fila que existe cuestan unos 30 bytes. Un snapshot cuesta ~400 bytes, con tres índices.

**Porque una vista con nombre propio hace visible la regla.** Una lectura nueva contra `character_snapshots` que busque la última observación perdería en silencio a quien lleva días sin cambiar, y es más fácil verlo en revisión si la regla es «la última observación se lee de `character_observations`».

## Consecuencias

- **Paso 1 (migración 0032 y lecturas):** no ahorra nada todavía. Reescribe una vez las ~138.000 filas de `character_presence` (unos 16 MB de hueco hasta que se reutilice o se compacte).
- **Paso 2 (archivado):** el primer `archive-snapshots` suelta las anclas cubiertas, la mayoría de las ~135.000, porque solo ~42.000 series tienen filas de leaderboard en la ventana caliente. Calculo unos 40-45 MB netos, que la cuota ve tras un `compact` de `character_snapshots`. Cada serie nueva deja de dejar un snapshot más.
- **Comprobar antes del paso 2**, en el SQL editor, que la copia coincide con el último snapshot de leaderboard de cada serie: con las anclas todavía en la tabla, la vista no tiene que devolver ninguna fila con `from_presence`.
- **Una lectura nueva de la última observación lee de `character_observations`.** La tabla sola ya no contesta esa pregunta.
- **Reingerir un archivo viejo de la caché** compara contra la vista, que puede no tener la fila anterior a esa captura si el ancla ya salió. Insertaría una fila que antes se habría descartado por redundante. Es un caso de recuperación manual, y el índice de captura sigue impidiendo duplicados.
- **Una temporada cerrada** saca la presencia entera a Storage con sus columnas nuevas (ADR 0042), y la vista deja de devolverla con ella.
