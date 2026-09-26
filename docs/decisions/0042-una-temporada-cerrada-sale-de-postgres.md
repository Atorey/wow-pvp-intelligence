# ADR 0042 — Una temporada cerrada sale de Postgres entera

**Fecha**: 26 de septiembre de 2026 · **Estado**: aceptada (issue #132; completa el [ADR 0034](0034-historico-frio-archivado-en-storage.md) para temporadas que ya no se juegan)

## Contexto

El archivado del ADR 0034 conserva en Postgres, fuera de la ventana caliente, el ancla por origen, el último gear, los últimos talentos y el pico de **cada serie**, en cualquier temporada. Tiene sentido mientras la temporada se juega: la ingesta compara con el ancla, la actividad hereda desde ella y la ficha enseña el pico.

Medido el 26 de septiembre de 2026, con la temporada 42 en curso:

- La temporada 41 tiene **134.335 series**, y siguen en tres tablas: 134.934 filas en `character_snapshots`, 134.335 en `character_activity` y 134.335 en `character_presence`. Proporcionalmente, son unos **130 MB** de los 665 que ocupa la base.
- Ninguna de esas filas la lee ya el pipeline. La ingesta y el recálculo de actividad solo trabajan con la temporada vigente, y la 41 no tiene agregados.
- **La web sí**: la ficha de un personaje que solo jugó la 41 enseña su rating, su pico, su actividad y su equipo de entonces, porque su última temporada observada es esa. Nunca pudo enseñarle un Player Gap, porque no hay agregados de la 41.

## Decisión

1. **Una temporada se da por cerrada** cuando hay otra más nueva con observaciones y ella lleva **14 días sin ninguna nueva**. En el cambio de temporada conviven filas de las dos durante días; dos semanas de silencio son la prueba de que ya no llega nada.
2. **Sus snapshots salen todos**, sin conjunto de conservación y sin esperar a la actividad, por el mismo bucle de `archive-snapshots`: pasan por el índice de rating ([ADR 0039](0039-el-historico-de-rating-se-lee-de-un-indice-en-storage.md)) antes del borrado y quedan en `snapshot_archive_batches` como cualquier lote.
3. **Detrás salen sus tablas derivadas**: actividad, presencia, segmentos, agregados y cobertura. Se suben como NDJSON comprimido a `seasons/s<temporada>/<corrida>/` y se borran en una transacción que tiene que alcanzar exactamente lo subido. Van después de los snapshots porque cada lote suma a la actividad las observaciones que archiva, y la fila que se sube tiene que llevar esa cuenta completa.
4. **`archived_seasons` es la bitácora**, una fila por temporada con lo movido de cada tabla, y es también lo que consulta la web.
5. **La ficha de quien solo consta en una temporada cerrada se lee del índice de rating de Storage**: por spec, el último rating observado y el máximo observado de esa temporada, y un texto que dice que el equipo, los talentos y la actividad de entonces están archivados. Se miran como mucho las dos temporadas cerradas más recientes, con el mismo tope de 3 s que la pestaña de histórico.
6. **No hay comando nuevo**: `archive-snapshots` lo hace cada noche. El día que cierre la 42 sale sola, catorce días después de su última observación.

## Por qué así la ficha

Había dos caminos, y la decisión la delegó el operador:

- **Tratarlo como «no le consta rating»** ([ADR 0036](0036-personaje-conocido-sin-rating.md)): no hay que tocar la web, pero ese estado dice que Blizzard contestó y no listó ningún Solo Shuffle, y de este personaje tenemos una temporada entera. Sería afirmar algo falso sobre lo que tenemos, que es justo lo que el ADR 0036 corrigió.
- **Leer de Storage lo que la ficha enseñaba**: es lo que se elige, pero recortado. El índice de rating ya guarda la serie entera de cada personaje por temporada y la web ya sabe leerlo. Equipo y talentos de hace una temporada no dicen nada del jugador de hoy, y reconstruirlos exigiría bajar los lotes del archivo, que son la población entera.

El resultado es honesto con lo que hay: una temporada, su rating y su máximo, y lo que no se enseña está nombrado.

## Por qué no las alternativas

- **Conservar en Postgres una fila resumen por serie cerrada.** Son 134.335 filas por temporada que se acumulan con cada una, en la base que tiene la cuota justa. El índice de Storage ya tiene esa información.
- **Archivar en cuanto empieza la temporada nueva.** En el cambio conviven las dos, y un rezagado de la vieja volvería a crear filas que habría que archivar otra vez. Con 14 días de silencio no pasa; y si pasara, la corrida siguiente lo archiva y `archived_seasons` suma.

## Consecuencias

- La primera corrida mueve la temporada 41 entera (unas 135.000 filas de snapshots, 134.335 de actividad y otras tantas de presencia) y reescribe sus 256 shards del índice de rating. Conviene lanzarla a mano la primera vez, con `--dry-run` antes, y **hace falta un `VACUUM FULL`** de las tres tablas después (`compact`).
- El espacio que se recupera es del orden de **130 MB**, según la proporción de filas. La cifra buena la da `db-size` después del compactado.
- El archivo gana una forma nueva de fichero, `seasons/…/<tabla>-<nnnn>.ndjson.gz`, con `select *` de cada tabla. Como los lotes de snapshots, no se lee de vuelta hoy.
- La ficha de un personaje de temporada cerrada ya no enseña equipo, talentos ni actividad. Se dice en pantalla.
- **Un personaje que vuelve a jugar** no necesita nada de esto: en cuanto consta en la temporada vigente, la ficha es la de siempre.
