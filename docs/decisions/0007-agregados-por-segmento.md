# ADR 0007 — Los agregados por segmento se materializan a diario, con la ventana de actividad declarada en cada fila

**Fecha**: 19 de agosto de 2026 · **Estado**: aceptada (implementa §27 y §28 del plan; issue #15)

## Contexto

§27 define dos entidades derivadas de `character_snapshots`: `PopulationSegment` —el escalón (temporada, bracket, spec, rango de rating) con su tamaño y su forma— y `AggregateSnapshot` —el `adoption_rate` de cada variable dentro de ese escalón, "calculado periódicamente sobre los CharacterSnapshot más recientes de cada Character que cae en ese segmento"—. §28 le pone cadencia: un job diario en el MVP.

Ninguna de las dos existía. La distribución por segmento se calculaba al vuelo dentro de la ingesta y solo para imprimirla en el log; los `adoption_rate` los recalculaba `player-gap` en memoria, desde un run muestreado concreto, cada vez que alguien pedía un reporte. Eso deja tres agujeros:

- **No se puede consultar.** La web de Phase 2 (#17, #18, #21, #22, #26) necesita leer "el segmento 1800-2000 de Frost Mage", no reejecutar el pipeline.
- **No hay `computed_at` ni `sample_size` almacenados**, que es exactamente lo que §28 exige para que el frontend nunca muestre un número sin poder trazar de dónde sale y cuándo se calculó.
- **No hay histórico de agregados**, y §27 define `Trend` (#27) como la comparación de dos `AggregateSnapshot` consecutivos del mismo segmento. Sin serie, no hay tendencia que calcular.

Hay además una dependencia abierta: §27 dice que **todo** cálculo de `AggregateSnapshot` filtra por ventana de actividad, y la ventana real —derivar `last_active` de la variación de `season_match_statistics.played`— es #16, que no está hecha.

## Decisión

1. **Dos tablas nuevas** ([migración 0005](../../db/migrations/0005_population_aggregates.sql)): `population_segments` (un escalón calculado, con su `sample_size`, su confianza, la forma de su distribución y sus denominadores) y `aggregate_snapshots` (un `adoption_rate` por variable, colgando de un escalón).
2. **Son tablas derivadas, no fuente de verdad.** Se reconstruyen enteras desde `character_snapshots` ejecutando el job. La regla append-only de [ADR 0002](0002-modelo-append-only.md) no se toca: sigue aplicando a los snapshots, que son lo único irrecuperable.
3. **Cada corrida inserta un juego nuevo de filas** con un `computed_at` común; nunca se hace `update` sobre un recálculo anterior. El histórico de agregados es lo que alimenta las tendencias.
4. **El cálculo vive en `packages/core`** ([aggregates.ts](../../packages/core/src/aggregates.ts)), con tests. El job solo carga población, llama y escribe.
5. **La actividad se mide por `captured_at`** —"lo hemos vuelto a ver en el ladder dentro de la ventana"— mientras #16 no exista, y el filtro está aislado en una única función (`withinWindow`).
6. **La ventana se elige por segmento**, no por bracket ni por corrida: 7 días si llegan a n=30, si no 14 (`pickActivityWindow`, §13.4), y **se guarda en la fila** (`activity_window_days`).
7. **Se guarda todo lo observado**, incluidos los segmentos con muestra insuficiente y las variables que lleva una sola persona. Sin filtro por adopción mínima.
8. **Los snapshots con `source = 'search'` no entran** en el agregado, pero se cuentan aparte en `excluded_search`.
9. **Una sola temporada por corrida**: la más alta observada en la ventana.
10. **Runner: cron diario propio en GitHub Actions** ([aggregates.yml](../../.github/workflows/aggregates.yml)), separado del batch de leaderboard, con `workflow_dispatch` y `--dry-run` para inspeccionar sin escribir.

## Por qué

**Materializar en vez de calcular al vuelo** no es una optimización, es lo que hace auditable el número. Un `adoption_rate` recalculado en cada visita no tiene fecha: si mañana da otro resultado, nada dice si cambió la población o cambió el código. Con la fila almacenada, el porcentaje que vio el jugador el martes se puede reproducir el viernes. Y es la única forma de tener tendencias: §27 las define como diferencia entre dos agregados consecutivos, así que la serie es el producto, no un subproducto.

**Derivadas, y por eso fuera de la regla 1 del proyecto.** Merece decirlo explícito porque roza el ADR 0002: aquí sí se puede borrar. La diferencia es qué se destruye. Un `update` sobre un snapshot destruye una observación que Blizzard no volverá a dar; borrar un recálculo solo obliga a volver a ejecutarlo. Esto también acota la política de retención que decida #48: los agregados son el sitio barato por donde recortar, y los snapshots el caro.

**Guardar lo que no se puede enseñar.** Un segmento con n=12 no se muestra —eso lo decide `canShowComparison()` en el consumidor, como manda [ADR 0003](0003-umbrales-de-confianza.md)— pero sí se guarda. Guardar no es mostrar, y necesitamos la fila para responder a la pregunta que el producto tiene abierta desde que la ingesta pasó a 40 specs: **cuánto le falta a las specs de tanque para llegar a n=30**, y si llegan alguna vez. Filtrar al escribir dejaría esa pregunta sin datos y, de paso, convertiría un hueco en la tabla en algo ambiguo entre "no hay nadie" y "no llegaba al umbral".

**Sin filtro de adopción mínima**, por lo mismo y por una razón técnica: §13.3 define el poder discriminante como la varianza del `adoption_rate` entre segmentos consecutivos, y eso necesita justamente las adopciones bajas para saber qué variable _no_ discrimina. Ocultar las diferencias pequeñas (§13.5) es una regla de presentación; aplicarla al guardar destruiría la entrada del cálculo. El coste es volumen de filas, que es una decisión de retención (#48) y no de agregación.

**Los denominadores se guardan aparte del `sample_size`** (`gear_sample`, `talent_sample`, `item_level_sample`). Es la mentira más fácil de contar con estos datos: un segmento tiene 3.000 personas, tenemos el perfil completo de 40, y "el 60% lleva este abalorio" se lee como 1.800 personas cuando son 24. Con las dos cifras en la misma fila, el consumidor no puede pintar el porcentaje sin su base real — la misma razón por la que `AdoptionRate` transporta su denominador en vez de recomponerlo al pintar.

**La ventana por `captured_at` es un proxy, y hay que decirlo.** Aparecer en el leaderboard no es haber jugado: quien está cómodamente dentro del top 5.000 sigue apareciendo en cada publicación aunque lleve una semana sin entrar. El sesgo tiene dirección conocida —**sobreestima la población activa del tramo alto**, justo el que no cae de la lista— y es distinto del sesgo del tramo bajo, donde un jugador desaparece del leaderboard en cuanto baja del corte. Se acepta porque la alternativa era bloquear #15 entero sobre #16, dejando sin publicar la distribución de 40 brackets que sí tenemos, y porque el reemplazo es barato: todo el filtro es una función y una columna que ya dice qué ventana se aplicó.

**La ventana se elige por segmento** porque el trade-off de §13.4 (frescura contra tamaño de muestra) no es el mismo en todo un bracket. Un mismo Frost Mage sobra de muestra a 7 días en 1800-2000 y no llega a 30 en 2600-2800; forzar una única ventana obligaría a perder frescura abajo o muestra arriba. Como cada fila declara la suya, dos segmentos con ventanas distintas siguen siendo comparables por quien los lee — que sabe que lo son.

**`source = 'search'` fuera del denominador** es la continuación de [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md), que separó esa población precisamente para poder tomar esta decisión. Entra por sesgo de selección —alguien se interesó por ese personaje— y meterla en el `n` que sostiene la confianza declarada contaminaría el número con el interés de terceros. El coste es real y conviene no maquillarlo: **1400-1800 es justo el tramo que el leaderboard no cubre**, y es donde vive el ICP, así que hoy ese rango se queda sin agregados. Por eso se cuenta en `excluded_search` en vez de descartarse en silencio: el día que ese número sea grande, la decisión se revisa con dato delante y con otro ADR, no de memoria.

**Una temporada por corrida** porque §27 lo prohíbe expresamente ("nunca mezclando specs distintas o temporadas distintas"). En el cambio de temporada conviven snapshots de las dos durante días, y sumarlos daría una distribución que no describe a ninguna. Se avisa por consola cuando hay más de una en la ventana, en vez de elegir en silencio.

**Runner propio y diario**, no encadenado a `refresh-leaderboard`: la cadencia de agregación es una decisión del plan (diaria) y la del leaderboard es la de Blizzard (~3h). Encadenarlos ataría una a la otra y haría que un fallo de la descarga se llevase por delante el agregado del día. Además este job **no llama a la API**: no gasta cuota ni necesita credenciales de Blizzard, solo `DATABASE_URL`.

## Consecuencias

- **El primer recálculo real dará distribución y casi nada de `adoption_rate`.** Los perfiles completos solo existen donde se ha ejecutado `sample-profiles` a mano, y con la ventana de 14 días la mayoría de los muestreados quedan fuera enseguida. El job lo dice al terminar en vez de dejar descubrirlo mirando una tabla vacía: sin perfiles dentro de la ventana no hay `adoption_rate`, solo población. Cerrar esa brecha es muestrear con la cadencia de la ventana, no relajar la ventana.
- **La cobertura de perfiles pasa a ser medible**: `gear_sample` frente a `sample_size`, por segmento y por día. Es el número que decide si Player Gap puede sostenerse fuera de los dos segmentos muestreados en Sprint 0.
- **El volumen depende de los perfiles, no de los 40 brackets.** Los escalones son cientos de filas por corrida; las variables, tantas como items distintos observados. Hoy es pequeño, y crecerá con el muestreo. Entra en el alcance de #48 junto con los snapshots, con la ventaja de que aquí recortar no destruye nada irrecuperable.
- **`segment_id` sigue siendo el identificador de `packages/core`** (`"1800-2000"`, y `"3000-Infinity"` para el tramo abierto). Es feo para una URL, y cuando #26 defina las rutas de SEO habrá que decidir si la clave pública es esa o `formatSegment()` (`"3000+"`). No se cambia aquí para no tener dos identificadores de segmento a la vez.
- **Cuando entre #16**, la ventana deja de medir "visto en el ladder" y pasa a medir "ha jugado". Los agregados anteriores no se recalculan hacia atrás: la serie tendrá un antes y un después, y la columna `activity_window_days` no lo distingue por sí sola. Habrá que anotar la fecha del cambio en ese issue.
- **Este ADR no cierra la fila "Jobs" de §29.** Sigue siendo cron de Actions, por las mismas razones que [ADR 0004](0004-job-programado-del-leaderboard.md): la cola con Redis vuelve a la mesa cuando haya trabajo disparado por un usuario que está esperando.
