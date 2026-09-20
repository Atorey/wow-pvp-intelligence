# ADR 0037 — Una variación se afirma si supera el ruido de su propia base, y el anti-FOTM se queda fuera

**Fecha**: 20 de septiembre de 2026 · **Estado**: aceptada (issue [#27](https://github.com/Atorey/wow-pvp-intelligence/issues/27)) · **Aplica el [ADR 0003](0003-umbrales-de-confianza.md) al eje temporal y hereda el principio del [ADR 0033](0033-la-confianza-se-deriva-no-se-guarda.md)**

## Contexto

La §19 del plan pide «variación de adoption rate (talentos/gear) entre dos snapshots (semana actual vs. semana anterior), por spec y segmento». La migración 0005 nombró esta issue en su propia cabecera al crear `aggregate_snapshots`, y la retención del [ADR 0019](0019-retencion-de-agregados.md) conserva **una corrida por semana ISO** precisamente para que la serie exista.

El cuerpo de la issue, en cambio, describe otra cosa: el criterio anti-FOTM de la §17, que exige que `representation` y `high_rating_representation` se muevan en la misma dirección durante ≥2 ventanas consecutivas. Son dos features con dos prioridades distintas —la §19 marca la primera como Core MVP y la segunda como V2— y la §26 da MVP+ a «Trends (semana a semana)» y V3 a «Alertas de tendencia».

Tres cosas medidas contra producción el 20 de septiembre de 2026 (EU, temporada 42) deciden el alcance y el método:

**1. El tramo alto no da para medir representación.** Por encima de `HIGH_RATING_FLOOR` (2400) hay **666 personajes en las 40 specs juntas**; la más poblada tiene 57. La §17 fija n≥100 para declarar una tendencia, así que `high_rating_representation` no llega al umbral **en ninguna spec**. Y el criterio pide ≥2 ventanas consecutivas, o sea tres medidas: la serie de `aggregate_snapshots` tiene tres corridas supervivientes —29 de agosto, 13 y 20 de septiembre— con un hueco de quince días entre las dos primeras.

**2. La variación de adopción, en cambio, sí es medible.** 50 escalones tienen `gear_sample ≥ 100`, 47 de ellos también en la corrida anterior, y los denominadores ya son estables: el cociente medio entre las dos corridas es **1,03** (164 frente a 170 perfiles, 157 frente a 155). En agosto no lo era —la muestra pasó de 4.152 a 12.100 perfiles en dos semanas— y entonces cualquier subida habría sido nuestra, no del meta.

**3. Un umbral fijo en puntos porcentuales no funciona.** El |Δ| semanal por familia de variable:

| Familia       | Pares | Mediana | p90   | Máximo | Con ≥10 pts |
| ------------- | ----: | ------: | ----- | -----: | ----------: |
| `gear-item`   | 2.172 |   3,6pp | 11pp  |   31pp |         275 |
| `talent-node` | 4.740 |   0,9pp | 4,7pp |   26pp |          55 |
| `pvp-talent`  |   251 |   2,0pp | 6,3pp |   12pp |           7 |
| `hero-tree`   |    78 |   1,6pp | 4,2pp |  8,5pp |       **0** |

Un corte en 10 puntos deja 275 movimientos de gear y ninguno de árbol de héroe; uno en 3 marca el 57% de las filas de gear, que es ruido. El gear se mueve porque la gente se está equipando y los talentos no: ningún número único distingue esos dos casos, porque lo que cambia entre familias no es el tamaño del movimiento sino el ruido que lo rodea.

## Decisión

1. **#27 implementa la variación de `adoption_rate` y nada más.** El criterio anti-FOTM de la §17 se queda fuera y pertenece a [#29](https://github.com/Atorey/wow-pvp-intelligence/issues/29), «Meta analytics completo», que es donde viven `representation` y `high_rating_representation`. Implementarlo hoy sería escribir una puerta que dice «no» siempre.
2. **El umbral no se escribe, se deriva de la fila.** `adoptionChange()` contrasta las dos proporciones con el error típico calculado sobre sus dos denominadores. Es el mismo principio del [ADR 0033](0033-la-confianza-se-deriva-no-se-guarda.md) —lo que se guarda es el denominador y el juicio se calcula al leer— aplicado al eje temporal.
3. **La significación es 0,01 y no 0,05.** Una corrida escribe del orden de 8.000 pares de variable y escalón; al 5% el azar solo devolvería unas 400 «tendencias». `MIN_TREND_Z = 2.58` deja 142 movimientos en toda la base, 124 de ellos de gear y ninguno de árbol de héroe.
4. **Las dos bases tienen que llegar a `MIN_SAMPLE_HIGH`.** Es el umbral que la §17 pide para declarar una tendencia, más alto que el de enseñar una comparación: una cifra puede ser publicable y su variación no serlo.
5. **El contraste trata las dos muestras como independientes,** aunque no lo sean —de una semana a otra volvemos a leer a mucha de la misma gente—. Eso lo hace conservador a propósito.
6. **La comparación es contra la corrida anterior que conserve agregados, no contra «hace siete días».** `readPreviousSegment()` lo resuelve con un `exists` sobre `aggregate_snapshots`, y la fecha real viaja hasta la pantalla.
7. **Una variable sin fila en la corrida anterior sale sin variación, nunca como subida desde cero.** La poda borra de las corridas viejas las filas con menos de cinco usuarios ([ADR 0019](0019-retencion-de-agregados.md)), así que una ausencia puede ser «no lo llevaba nadie» o «lo llevaban tres»: son indistinguibles, y `null` es «no disponible» (regla 5).
8. **No se abre `/trends`.** La variación se pinta en la página de segmento, que es donde el porcentaje ya tiene su denominador y su contexto al lado. El punto 5 del [ADR 0020](0020-mapa-de-rutas-del-sitio.md) sigue vigente: esa ruta queda declarada y sin código.
9. **Sin flecha, sin color y en puntos porcentuales.** El signo ya lleva la dirección; un verde arriba con un rojo abajo diría que subir es bueno, que convierte una correlación en un consejo sin escribir un solo verbo (regla 3). Y el vocabulario de tokens no tiene ese par ([ADR 0025](0025-componentes-con-shadcn-ui.md)).
10. **No se guarda nada nuevo.** La variación se calcula al leer, con dos filas que ya están en la base. No hay tabla, ni columna, ni job.

## Por qué

**Porque el ruido de una fila depende de la fila.** Ocho puntos sobre una base de 300 son indistinguibles del azar si la adopción ronda el 50%, y son un movimiento claro si ronda el 2%: la varianza de una proporción es máxima en el centro y se desploma en los extremos. Un umbral en puntos porcentuales ignora exactamente eso, y por eso un corte en 10 puntos marcaba 275 filas de gear y cero de árbol de héroe: no describe dos realidades distintas, describe un corte calibrado contra la distribución de una sola de las dos familias. `MIN_DISCRIMINATIVE_DELTA` razona igual en su comentario («indistinguible del ruido de muestreo con n=100») y luego lo congela en una constante; esto es ese razonamiento hecho por fila.

**Porque el 0,01 no es prudencia, es el número de comparaciones.** Con 8.000 contrastes por corrida, el 0,05 convencional garantiza cientos de falsos positivos: la página más poblada marcaría filas que no se han movido, y el producto que vende trazabilidad estaría inventando tendencias con la misma cara con la que declara denominadores.

**Porque preferimos callarnos un movimiento real a inventar uno que no existe.** Es la misma asimetría de la §1.5 del brief: una lista corta es un resultado, una lista rellenada no. Por eso el contraste conservador es una elección y no una concesión — con muestras que se solapan, el error típico real es menor y algo de lo que hoy se calla sí se podría afirmar.

**Porque «la semana pasada» es una frase, no un dato.** Entre el 29 de agosto y el 13 de septiembre de 2026 no hubo una sola corrida, y `population_segments` —que no se poda— tiene escalón casi todos los días mientras `aggregate_snapshots` solo conserva uno por semana. Emparejar contra «la corrida de ayer» habría devuelto una lista entera de variables sin pareja, que quien pinta leería como «todo es nuevo» cuando lo que pasa es que el detalle de ayer ya no está.

**Porque una tendencia no necesita su propia página para ser útil.** La pregunta que contesta —«¿esto que estoy mirando se está moviendo?»— se hace delante del porcentaje, no en un índice aparte. Una ruta `/trends` con 43 movimientos repartidos en 40 specs sería una página que se indexa vacía la mayor parte de la temporada, que es justo lo que el ADR 0020 evitó al dejarla declarada y sin código.

## Consecuencias

- **La página de segmento gana una cifra por fila y una línea por página.** La línea fecha la comparación **aunque no se haya movido nada**: sin ella, un tramo sin una sola marca se lee como que no medimos la variación, cuando lo que dice es que esta vez no hay nada afirmable.
- **La feature es casi solo de gear, y eso es el dato.** Sobre las corridas del 13 y el 20 de septiembre, 43 movimientos marcados en 4.994 filas de gear de cuatro specs; los talentos apenas se mueven. Que la sección de talentos salga sin marcas no es un fallo de cobertura: es que la build de una spec es estable de una semana a otra y el equipo no.
- **El número de marcas crecerá con la muestra, no con el tiempo.** El umbral es el ruido de la base, así que más perfiles por escalón hacen afirmables movimientos más pequeños. Es la dirección correcta y no hay que tocar nada para que ocurra.
- **[#29](https://github.com/Atorey/wow-pvp-intelligence/issues/29) hereda el anti-FOTM con su medición hecha**: las cifras del tramo alto de este ADR son las que dicen cuándo se podrá aplicar, y `HIGH_RATING_FLOOR` ya está en `packages/core` esperando.
- **Un reinicio de temporada vacía la comparación durante una semana.** `readPreviousSegment()` filtra por `season_id`, así que la primera corrida de una temporada nueva no tiene con qué compararse. Es correcto: un soft reset mueve a todo el mundo de tramo, y comparar a través de temporadas mediría el reset.
- **La cuota no se toca.** Con la base por encima del límite de Supabase, esta feature no añade ni una fila.
