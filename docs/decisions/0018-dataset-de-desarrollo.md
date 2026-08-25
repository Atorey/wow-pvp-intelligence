# ADR 0018 — El dataset de desarrollo se siembra crudo y lo agrega el pipeline

**Fecha**: 24 de agosto de 2026 · **Estado**: aceptada (issue [#64](https://github.com/Atorey/wow-pvp-intelligence/issues/64)) · **No sustituye a ningún ADR**; cierra el hueco que el [ADR 0014](0014-capa-de-lectura-compartida.md) dejó anotado ("no hay test contra el schema") y aplica al fixture la separación entre observación y cálculo del [ADR 0002](0002-modelo-append-only.md). **Desbloquea en la práctica todo el bloque de UI de la ola 2** ([#62](https://github.com/Atorey/wow-pvp-intelligence/issues/62), [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17), [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19), [#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18))

## Contexto

Hoy no se puede tocar la web sin una copia de la Postgres de producción: 840.240 filas en `character_snapshots` y credenciales de Blizzard para rellenarla. Eso convierte "abrir el proyecto" en un trámite de horas y hace imposible que nadie más colabore.

Y hay un segundo problema, más silencioso, anotado en el propio ADR 0014: **`packages/data` no tiene ni un test contra el schema**. Su ejecutor falso prueba el mapeo y qué SQL se emite —que es donde puede colarse una confianza leída de la columna equivocada—, pero no que las columnas existan. Un `rating_p25` mal escrito pasa el typecheck, pasa los tests y falla en la primera consulta real. La única forma de cerrarlo es tener una base con schema real y datos dentro, que es exactamente lo que hace falta para lo primero.

Al ir a escribirlo aparecieron dos decisiones que no son de implementación.

**La primera: qué se siembra.** La tentación es escribir directamente las filas que la web lee —`population_segments` con su `sample_size` y su `confidence`, `aggregate_snapshots` con sus porcentajes—, porque es lo más corto y da control absoluto sobre el escenario. Pero esas tablas son derivadas: el pipeline las reconstruye enteras desde `character_snapshots`, y sembrarlas a mano permite guardar combinaciones que el pipeline **nunca produce**. La más importante ya ha pasado de verdad: 59 filas guardadas como `high` con `gear_sample = 0` ([#76](https://github.com/Atorey/wow-pvp-intelligence/issues/76)). Un fixture escrito a mano enseñaría a la web a esperar coherencia donde la realidad no la tiene, o al revés.

**La segunda: dónde escribe.** `DATABASE_URL` apunta en este repo a la Supabase de producción. Un comando que inventa población y lee esa variable es, a un despiste de distancia, un comando que mete cientos de personajes falsos en el histórico append-only que el ADR 0002 declara el moat del producto — y que además infla los tamaños de muestra sobre los que el producto declara su confianza ([ADR 0003](0003-umbrales-de-confianza.md)).

## Decisión

1. **`seed` escribe observaciones, nunca cálculos.** Siembra `characters`, `character_snapshots`, `character_snapshot_gear` y `character_presence`, y después ejecuta `refresh-aggregates` sobre lo sembrado, que es quien produce `character_activity`, `population_segments` y `aggregate_snapshots` — el job de producción, sin ramas especiales para el seed. Lo que la web lee lo ha calculado el mismo código que lo calculará en producción.

2. **El plan declara población, no confianza.** `SEGMENT_PLAN` dice cuánta gente hay en cada escalón y cuánta trae perfil; la confianza sale de contar. Un escalón con 9 perfiles saldrá `insufficient` porque lo es, no porque el fixture lo diga.

3. **Solo escribe en una base local, y no hay flag para saltárselo.** El guardarraíl mira el host que resuelve `DATABASE_URL` y falla cerrado: lo que no parsea cuenta como remoto. `--reset` trunca antes de sembrar, y eso no incumple el ADR 0002 — ahí no hay histórico observado, hay lo que dejó la corrida anterior.

4. **Misma semilla, mismo dataset; las fechas, no.** El contenido es determinista hasta el último item. Las marcas de tiempo se anclan al momento de sembrar porque `refresh-aggregates` recorta por ventana de actividad contra su propio reloj: un dataset con fechas fijas se queda sin población a las dos semanas de escribirlo.

5. **Personajes ficticios, items reales.** Los nombres se generan; los `item_id` y sus nombres salen de contar el equipo de los 593 perfiles del muestreo de Sprint 0, así que la forma de la distribución —un item dominante por slot y una cola larga— es la observada. Es la diferencia entre un `adoption_rate` con la pinta que tendrá y uno inventado. Los `realm_slug` también son reales, incluido uno acentuado.

6. **El reparto de items se inclina hacia el item level alto según sube el escalón.** Sin esa inclinación, dos segmentos consecutivos tendrían la misma distribución de equipo y ninguna diferencia pasaría `isDiscriminative()`: la caja del Player Gap saldría vacía en un dataset lleno.

7. **El dataset cubre a la vez los escalones llenos y los vacíos**, y cada fila del plan declara qué estado de pantalla existe gracias a ella. Están los tres estados de confianza del [brief](../design/brief.md#15-los-tres-estados-de-confianza), el escalón con población suficiente y base de comparación insuficiente (#76), una spec entera fuera de cobertura ([#58](https://github.com/Atorey/wow-pvp-intelligence/issues/58)) y dos temporadas conviviendo.

8. **El test de integración de `packages/data` corre contra `TEST_DATABASE_URL`, nunca contra `DATABASE_URL`.** Es una variable aparte y no cae de vuelta a la otra: el test trunca lo que encuentra, y `npm test` no puede llevarse por delante la base con la que alguien está desarrollando la web. Si no está definida, el test se salta diciendo por qué. En CI la define el servicio de Postgres del workflow.

## Por qué

**Porque un fixture que no puede reproducir el estado malo no sirve para lo que hace falta.** La razón de ser del MVP es una pantalla que hoy, con datos reales, no se puede pintar: en la temporada 42 no hay un solo segmento capaz de sostener un Player Gap ([§13 de findings](../sprint-0-findings.md)). Un dataset calcado de eso no dejaría desarrollar nada; uno solo de escalones llenos produciría una web que se rompe el primer día. Las dos cosas juntas, con cada escalón declarando qué caso es, es lo único que deja construir la pantalla y su ausencia a la vez.

**Porque las tablas derivadas se ganan, no se declaran.** Si el seed escribiera `population_segments`, el test de integración estaría comprobando que `packages/data` sabe leer lo que el propio test acaba de escribir — una tautología con forma de cobertura. Pasando por `refresh-aggregates`, lo que se comprueba es que el pipeline sabe producir lo que la web espera leer, que es la pregunta que de verdad importa y la que ninguna de las dos capas puede contestar sola.

**Porque el guardarraíl tenía que ser el destino y no una confirmación.** Un `--yes` en un script anula cualquier "¿seguro?". Mirar el host es la única comprobación que no depende de que alguien lea el aviso, y la asimetría manda: negarse a sembrar una base local cuesta un mensaje de error; sembrar producción no tiene vuelta atrás.

**Porque reutilizar `upsertCharacters` e `insertProfileSnapshot` es lo que hace que el test valga.** Con su propio INSERT, el seed podría seguir en verde con el camino de producción roto — justo el hueco que este issue viene a cerrar. La escritura del fixture pasa por el mismo código que la ingesta real.

## Consecuencias

- **`packages/data` deja de poder romperse en silencio.** Cualquier columna renombrada en una migración, o cualquier lectura que pida una que no existe, rompe el CI en vez de descubrirse sirviendo una página.
- **El CI necesita una Postgres.** Es un servicio del workflow, ~10 s de arranque y nada que mantener; si algún día no está, el test se salta solo y lo dice, que es peor que ejecutarlo pero mejor que fallar sin motivo.
- **El pipeline pasa a depender de `@wowpvp/data`** (como devDependency: solo lo importa el test). Es uno de sus dos consumidores previstos en el ADR 0014, así que no abre una dependencia nueva, la hace explícita.
- **Hay once personajes cuyos nombres son ahora parte del contrato de desarrollo.** Cambiarlos rompe la documentación y las URLs que la gente tenga a mano; añadir casos nuevos no.
- **El plan del dataset envejece con el producto.** Está atado a los umbrales de `packages/core` —hay un test que lo fija— y a los escenarios de hoy. Cuando entre #66 y los `gear_sample` reales suban, el seed seguirá siendo el mismo mundo optimista: es un fixture, no una previsión, y la cobertura real se vigila en [#74](https://github.com/Atorey/wow-pvp-intelligence/issues/74).
- **Lo que el seed no siembra**: `leaderboard_fetches` y `character_lookups`. Son bitácora del pipeline, no población, y el producto no las consulta. Quien trabaje sobre ellas las llenará con los jobs que las escriben.
