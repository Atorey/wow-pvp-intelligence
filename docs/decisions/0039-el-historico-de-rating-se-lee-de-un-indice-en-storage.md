# ADR 0039 — El histórico de rating se lee de un índice por personaje en Storage

**Fecha**: 26 de septiembre de 2026 · **Estado**: aceptada (issue #28; revisa el punto 7 del [ADR 0034](0034-historico-frio-archivado-en-storage.md))

## Contexto

La issue #28 pide el gráfico de evolución del rating de un personaje (§20 y §26 del plan, MVP+). La serie que ese gráfico necesita ya no está entera en ningún sitio que la web pueda leer: desde el ADR 0034, `character_snapshots` guarda 14 días más el ancla, el último gear, los últimos talentos y el pico de cada serie, y lo demás está en Supabase Storage. El punto 7 de ese ADR dejó el archivo como de solo escritura y el día de leerlo para cuando existiera esta pantalla.

Medido en producción el 26 de septiembre de 2026:

- La temporada 42 tiene **108.665 series** `(personaje, bracket)`. La mediana tiene **4 observaciones en toda la temporada**, y 53.000 series tienen 5 o más.
- De sus 816.062 observaciones, **423.541 ya están archivadas**.
- Lo que queda en Postgres da una mediana de **2 puntos por serie**. Un gráfico hecho solo con eso estaría vacío para la mayoría de las fichas.
- La base ocupa **665 MB** contra una cuota de 500, con la restricción del proyecto el 19 de octubre. Cualquier tabla nueva empeora eso.
- El archivo son 55 lotes por fecha de corrida, con la población entera dentro. Leer de ahí la temporada de una sola persona obliga a bajarse todos.

## Decisión

1. **El archivado deja un índice por personaje en el mismo bucket**, bajo `rating-history/s{temporada}/{shard}.json.gz`. Cada punto es solo `[milisegundos, rating]`, sin gear, talentos ni partidas, porque es lo único que pinta la serie.
2. **256 shards por temporada, por los dos primeros dígitos del `characters.id`.** El id es un uuid v4 y ya está repartido de forma uniforme, así que no hace falta hash. Salen unas 400 series por objeto, unas decenas de KB comprimidas: lo que cuesta una visita a la pestaña.
3. **Se indexa antes de borrar.** `archive-snapshots` funde en el índice las filas que va a archivar antes de subir y borrar el primer lote. Si falla ahí no se ha borrado nada; si falla después, las filas indexadas siguen calientes.
4. **La fusión es una unión por fecha.** Dos puntos con la misma fecha al milisegundo son la misma observación (`mergeRatingPoints` en core). Es conmutativa e idempotente: reindexar un lote o repetir el backfill no cuenta nada dos veces. Lo único que no soporta son dos procesos escribiendo el mismo shard a la vez; si pasara, volver a lanzar el backfill lo repara, porque relee todos los lotes.
5. **Lo archivado antes de este ADR entra una sola vez** con `backfill-rating-history`. Recorre `snapshot_archive_batches` y comprueba que cada lote tiene las filas que dice la bitácora.
6. **La web une las dos mitades al leer.** Los puntos calientes salen de Postgres (`readRatingPoints`) y los archivados, del shard. **Y comprueba que la suma cuadra**: `character_activity.archived_observations` dice cuántas observaciones se archivaron, y si el índice trae menos, o no se puede leer, la página dice cuántas faltan en vez de pintar media temporada como si fuera entera.
7. **Solo se va a Storage cuando hay algo archivado** y solo desde la pestaña de histórico, con un tope de 3 s. El resumen del perfil no paga ese viaje.
8. **El cliente de Storage pasa a un paquete propio, `@wowpvp/storage`**, porque ahora lo usan pipeline y web y una app no importa de otra. No va a `@wowpvp/data`: ese paquete son lecturas contra Postgres y no escribe ([ADR 0014](0014-capa-de-lectura-compartida.md)).
9. **La web recibe `SUPABASE_SERVICE_ROLE_KEY`** para leer un bucket que sigue siendo privado. No abre nada que `DATABASE_URL`, que ya tiene, no abra: las dos son del mismo proyecto y se quedan en el servidor. Si falta, la web arranca igual y la pestaña declara que no puede leer lo archivado.

## Por qué no las alternativas

- **Una tabla compacta en Postgres**, una fila por serie con arrays de fechas y ratings: se lee con una consulta, pero son unos 25-50 MB más, sumando la hinchazón de reescribirla cada noche, en una base que está 165 MB por encima de la cuota.
- **Solo la ventana caliente**: nada nuevo que guardar, pero con una mediana de 2 puntos no es un histórico.
- **Leer los lotes del archivo desde la web**: sería bajarse la población entera por cada visita.
- **Un bucket público**, para leer sin clave: sacaría de la web una copia de la población que la web enseña de una en una. Es el mismo motivo por el que el archivo es privado.
- **Un punto por día**: ahorra poco con estos tamaños, y el máximo del día se perdería. La ficha llama «máximo observado» a un pico que el gráfico tiene que poder enseñar.

## Consecuencias

- **El índice ocupa Storage, no base.** Estimado, no medido: la temporada 42 entera son unos 22 MB de JSON, del orden de 10 MB comprimidos, frente al GB del plan gratuito, del que el archivo ya usa una parte. El backfill imprime lo que sube, y esa es la cifra buena.
- **Hasta que corra el backfill, las fichas con histórico archivado declaran el hueco.** Es el comportamiento correcto, no un fallo: la cifra que falta se enseña.
- **`archive-snapshots` reescribe cada noche los shards que toca**, como mucho 256 por temporada. Son lecturas y escrituras de Storage, no de la base.
- **El formato lleva versión** (`v: 1`). Un cambio de forma es un formato nuevo que quien lee tiene que reconocer, no un fichero que se interpreta a medias.
- **La pestaña no relaciona la curva con nada**: ni equipo ni talentos de cada momento al lado. Junto a una subida se leerían como su causa (regla 3).
