# ADR 0034 — El histórico frío de `character_snapshots` se archiva en Storage

**Fecha**: 19 de septiembre de 2026 · **Estado**: aceptada (issue #48; revisa el [ADR 0002](0002-modelo-append-only.md) sin derogarlo)

## Contexto

La base de producción está en **961 MB** contra una cuota de **500 MB** en el plan gratuito de Supabase, que restringe el proyecto el **19 de octubre de 2026**. La restricción del operador es firme: ni se paga ni se cambia de proveedor. La retención de agregados (PR #120) ya bajó de 1.176 a 961 MB tocando solo tablas derivadas. Lo que queda son observaciones.

Medido el 19 de septiembre de 2026:

- Las tres tablas de observación son 792 de los 961 MB. `character_snapshots` sola son 471 MB, **254 de ellos en índices**.
- **1.172.545 de sus 1.463.163 filas (80%) tienen más de 14 días.** Los dos índices más grandes (204 MB) contestan «¿cuál es la fila más nueva de este personaje?», y esas filas no lo son ni lo volverán a ser.

El ADR 0002 justificaba guardarlo todo con dos frases: el coste es «casi nulo (filas en Postgres)» y el pasado que no se captura «no se recupera». La primera ha dejado de ser verdad. La segunda sigue en pie: Blizzard no tiene endpoint de histórico.

## Decisión

1. **Postgres guarda los últimos 14 días.** No es un número elegido: es la ventana de actividad más larga con la que se agrega (`ACTIVITY_WINDOWS.fallback`, §13.4), y el job se niega a bajar de ahí.
2. **Lo anterior se vuelca a Supabase Storage y se borra de Postgres**, con su gear y sus talentos. Storage tiene su propio GB en el plan gratuito, separado de los 500 MB de la base: es el mismo proyecto, no otro proveedor. Bucket privado, porque guarda la población entera con nombre y reino.
3. **Fuera de la ventana se queda también lo que alguien lee.** Por cada serie `(personaje, bracket, temporada)`:
   - **el ancla**: la última fila anterior al corte **de cada origen**. La lee la ingesta por cambio ([ADR 0009](0009-ingesta-por-cambio-de-poblacion.md)), la ficha del jugador (`readLatestSnapshot`, `readStanding`) y el recálculo de actividad;
   - **la última fila con gear y la última con talentos**, que es como las buscan `readLatestGear` y `readLatestTalents`;
   - **el pico de rating**, que `readPeakRating` calcula sobre la temporada entera.
4. **La actividad deja de reconstruirse desde cero.** El [ADR 0008](0008-ventana-de-actividad-por-partidas-jugadas.md) la deriva de la serie entera, y la fecha de arranque y una subida vieja del contador están, por definición, en lo archivado. Cada recálculo parte de la fila anterior de `character_activity` y le suma la serie caliente (`withArchivedActivity` en core). Es exacto porque todo lo heredado es monótono, y lo sostienen dos garantías del archivado: el ancla sigue caliente, y solo se archiva una fila que el último cálculo de su serie ya había visto. El recuento de observaciones es lo único que no se puede heredar así, y lo guarda `character_activity.archived_observations`, que el archivado mueve en la misma transacción que el borrado.
5. **Primero se sube y después se borra, lote a lote.** La subida no sobrescribe nunca (`x-upsert: false`). Si algo falla entre medias, lo peor que queda es un lote repetido en el archivo, que se deduplica por `id`. `snapshot_archive_batches` hace de índice: qué carpeta, qué rango de fechas y cuántas filas de cada tabla.
6. **Formato: NDJSON comprimido, una fila por línea, `select *`.** Los arrays y los `null` que significan «no disponible» (regla 5) sobreviven tal cual, y una columna nueva entra en el archivo sin tocar el job.
7. **El archivo es de solo escritura en esta versión.** Nadie lee el pasado hoy. Leerlo de vuelta es trabajo del día que exista Progresión, no de este.
8. **`characters`, `character_presence` y `character_activity` no se archivan**: son estado actual. Pero las dos últimas son derivadas de filas que ya no están en Postgres, así que **ya no se pueden reconstruir enteras. Vaciarlas pierde información.**

## Por qué no las alternativas

- **Rollup a una fila por día o semana**: sigue creciendo en la misma tabla y los mismos índices, y cambia qué es una fila. El problema no es la resolución del histórico, es dónde vive.
- **Borrar sin copia**: es justo lo que el ADR 0002 prohíbe con razón.
- **Bajar la cadencia del cron**: desde el ADR 0009 una lectura sin cambios no escribe nada. Leer menos no ahorra filas, solo resolución.
- **Pagar o migrar**: descartado por el operador.

## Consecuencias

- `character_snapshots` pasa de 1.463.163 a unas 516.000 filas (946.885 archivables en la simulación del 19 de septiembre), y a partir de ahí crece lo que entra en 14 días más una fila por serie.
- **Con esto solo no se baja de 500 MB.** Las filas archivables casi no tienen gear ni talentos (14.146 filas de gear, ninguna de talentos): el gear y los talentos de hoy cuelgan de perfiles recientes, y casi todos son el último de su personaje. Esas dos tablas son 321 MB y crecen unos 13 MB al día. Cómo se abaratan es otra decisión, no esta.
- **El espacio no vuelve solo.** Un `delete` deja hueco que reutilizan las inserciones siguientes, pero la cuota mide el fichero. Tras el primer archivado hace falta un `VACUUM FULL character_snapshots` a mano, que bloquea la tabla y necesita espacio para una copia. En régimen estable no hace falta: cada día se archiva más o menos lo que entra.
- `player-gap --run` sobre un muestreo de hace más de 14 días deja de encontrar sus snapshots. Es una herramienta de desarrollo sobre corridas de `sample-profiles`, que ya no es el camino del producto.
- La ventana `seasonActive` de 30 días (`ACTIVITY_WINDOWS`) no se puede calcular sobre la tabla cruda. No tiene código hoy. Cuando lo tenga, sale de `character_activity`, que conserva la fecha de actividad entera.
- El job corre a diario detrás de `refresh-aggregates`, que acaba de recalcular la actividad, y necesita `SUPABASE_SERVICE_ROLE_KEY`.
