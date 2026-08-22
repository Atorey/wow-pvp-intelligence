# ADR 0010 — Se lanza con las 40 specs y la cobertura decide, no una lista

**Fecha**: 21 de agosto de 2026 · **Estado**: aceptada (issue #56, decisión 1 del GO de Sprint 0)

## Contexto

La §3 de [sprint-0-findings](../sprint-0-findings.md) dejó abierta una decisión de producto: el ICP declarado es 1400-2200, pero el tope de 5.000 por spec parecía impedir servir por debajo de ~1800 en las specs más jugadas. La disyuntiva escrita era "o se lanza con specs de cobertura buena, o la acumulación por búsqueda entra antes del lanzamiento".

Dos cosas invalidan esa disyuntiva tal como estaba planteada.

**La acumulación por búsqueda ya no es una alternativa: está construida.** #14 se cerró con el [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md). Lo que falta no es el mecanismo, es el tráfico que lo alimente, y eso no existe antes de lanzar.

**Y los números de §3 son de una temporada terminada.** La 41 acabó el 19 de agosto y la 42 empezó ese mismo día ([ADR 0008](0008-ventana-de-actividad-por-partidas-jugadas.md)). Medido el 21 de agosto de 2026 sobre EU, contando el snapshot más reciente por personaje y bracket en buckets de 200, cuántas de las 40 specs alcanzan `MIN_SAMPLE_MEDIUM` (n≥30) en cada segmento:

| Segmento  | Temporada 41 (madura, tope activo) | Temporada 42 (2 días de vida) |
| --------- | ---------------------------------: | ----------------------------: |
| 1200-1400 |             15 specs (3.867 pers.) |        20 specs (1.567 pers.) |
| 1400-1600 |             17 specs (6.415 pers.) |        17 specs (1.496 pers.) |
| 1600-1800 |            25 specs (14.949 pers.) |        21 specs (1.940 pers.) |
| 1800-2000 |            28 specs (29.429 pers.) |        12 specs (1.161 pers.) |
| 2000-2200 |            26 specs (20.596 pers.) |        **1 spec (287 pers.)** |
| 2200-2400 |            27 specs (18.962 pers.) |            0 specs (81 pers.) |

**Los dos perfiles de cobertura son inversos.** En una temporada madura el tope de 5.000 corta por abajo y sobra población arriba; en una recién empezada no hay tope que aplique —la spec más poblada de la 42 tiene 1.817 personajes, muy lejos del corte— y lo que falta es la parte alta. El rango bajo del ICP, que §3 daba por problemático, es hoy el mejor cubierto.

**Lo que decide un Player Gap no es el segmento del sujeto, es el del objetivo.** La comparación es contra el segmento inmediatamente superior (§13.1 del plan), así que la cobertura servible es la del par. Contando en cuántas specs el segmento siguiente llega a n≥30, temporada 42:

| Segmento del sujeto | Specs con objetivo servible |
| ------------------- | --------------------------: |
| 1400-1600           |                          21 |
| 1600-1800           |                          12 |
| 1800-2000           |                       **1** |
| 2000-2200           |                           0 |

**Y ninguna lista de specs escrita hoy sobrevive a la temporada.** Las 3 validadas en Sprint 0 —Frost Mage, Restoration Shaman, Fury Warrior— no son las más pobladas de la 42: Holy Priest tiene 1.817, Retribution Paladin 1.354, Arms Warrior 1.286, y Frost Mage cae al puesto 12 con 662. Una lista fijada en el lanzamiento sería un compromiso público con la foto de una semana.

**El censo tampoco es la salida.** §4 lo midió: los dos buckets completos de 3 specs son ~25.900 peticiones ≈ 2,2 h al ritmo real de 3,2 req/s, y el techo configurado es 24.000/h. A 40 specs no cabe.

**El cuello real no es la lista de specs, es la base de perfiles.** Los agregados del 20 de agosto de 2026 tienen **1.424 filas en `population_segments`, 357 de ellas con n≥30 de población, y `gear_sample = 0` en todas**. <sup>Corregido el 22 de agosto de 2026 ([§13.1 de findings](../sprint-0-findings.md)): esas dos cifras son el acumulado de la tabla entera y no la corrida del 20, que tuvo 400 filas y 144 con n≥30 — cada corrida inserta un juego nuevo de filas (punto 3 del [ADR 0007](0007-agregados-por-segmento.md)). El `gear_sample = 0` sí es por corrida y sigue siendo cierto, así que el argumento y la decisión no cambian.</sup> Los 595 perfiles muestreados son de la temporada 41 y `refresh-aggregates` agrega solo la vigente, así que hoy **ningún segmento puede pintar un Player Gap**, con lista de specs o sin ella. Que ese cero se vea es el [ADR 0007](0007-agregados-por-segmento.md) funcionando: guardar `gear_sample` aparte de `sample_size` existe justo para que la falta de gear no se disfrace de población.

## Decisión

1. **No hay lista de specs de lanzamiento.** Las 40 del catálogo se ingieren, se muestrean y se ofrecen. Ninguna se excluye a priori por su popularidad.
2. **La unidad de cobertura es el par `(spec, segmento objetivo)`, no la spec.** Una spec no "está" o "no está": tiene Player Gap servible en los segmentos donde su segmento siguiente llega al umbral, y no lo tiene en el resto. La misma spec puede servir 1600-1800 y no servir 1800-2000.
3. **`canShowComparison()` es la única puerta**, ya en producción ([confidence.ts](../../packages/core/src/confidence.ts)), y se evalúa contra el `gear_sample` del segmento objetivo, no contra su `sample_size`. Población no es base de comparación.
4. **#66 muestrea por cuota por segmento, no por censo.** Objetivo `MIN_SAMPLE_HIGH` (100) por par `(spec, segmento)` dentro de la ventana de actividad vigente, con `MIN_SAMPLE_MEDIUM` (30) como suelo por debajo del cual el par simplemente no se sirve. No se inventa un umbral nuevo: son los que ya viven en `packages/core`.
5. **La cuota se gasta de abajo arriba dentro del ICP.** Con presupuesto insuficiente para todos los pares, se prioriza el segmento objetivo que más sujetos desbloquea —el que tiene más población en el segmento inmediatamente inferior—, no el de rating más alto. Un segmento objetivo muestreado sin sujetos debajo no sirve a nadie.
6. **La base de comparación es siempre de la temporada vigente.** Ya es el comportamiento de `refresh-aggregates`, y aquí queda como decisión y no como detalle de implementación: perfiles de la temporada anterior no rellenan el hueco del arranque de temporada. El gear se resetea; usarlos sería fabricar la comparación que el producto promete no fabricar.
7. **El copy no promete cobertura por spec.** Nada de "cubrimos las 40 specs" ni listas en la portada. Lo que se declara es por página: qué segmento, qué n, qué confianza, y por qué no hay comparación cuando no la hay (#58).

## Por qué

**Fijar una lista es prometer lo que no controlamos.** La cobertura de una spec no es una propiedad de la spec: es el resultado de cuánta gente la juega, dónde corta el tope de 5.000 y en qué punto de la temporada estamos. Los dos perfiles de cobertura medidos arriba son del mismo pipeline con dos semanas de diferencia. Una lista publicada sería falsa cada vez que Blizzard reinicia la ladder, y quitarla después es peor que no haberla puesto.

**Y es prometer de más justo donde el producto promete de menos.** La regla 2 del proyecto ya dice qué hacer cuando no hay muestra: no enseñar la comparación y explicar por qué. Eso es exactamente un mecanismo de cobertura variable, ya construido y ya probado. Fijar además una lista de specs sería tener dos mecanismos que responden a la misma pregunta, y el peor de los dos —el estático— ganando.

**Medir el par y no la spec** porque es lo que de verdad se puede servir. Contar "specs con datos" habría dado 33 de 40 en la temporada 42 y habría sonado a cobertura excelente; el número honesto es que hoy hay **una sola** spec con el segmento 2000-2200 poblado, y cero pares servibles por encima de 2000. La granularidad equivocada convierte un problema de producto en una métrica tranquilizadora.

**Contra `gear_sample` y no contra `sample_size`** porque son cosas distintas y hoy difieren en tres órdenes de magnitud: 31.488 personajes de población frente a 0 perfiles con gear. El ADR 0007 ya guarda los dos números por este motivo; si la puerta mirase el primero, el producto pintaría comparaciones sobre un denominador vacío y con confianza `high`.

**Cuota y no censo** porque el censo ni cabe ni aporta. §4 midió que n=100 ya es confianza `high` y que el bucket completo son 25.900 peticiones para tres specs. Pagar el censo compra decimales en el `adoption_rate` a cambio de renunciar a 37 specs.

**De abajo arriba** porque la aritmética de la comparación no es simétrica. Muestrear 2000-2200 sirve a los sujetos de 1800-2000; muestrear el segmento más alto no sirve a nadie porque no hay nada encima con lo que compararlo. Con el presupuesto apretado, el orden de gasto decide a cuántos usuarios reales alcanza el mismo número de peticiones.

**No rellenar con la temporada anterior** porque es la tentación exacta contra la que existe el producto. Al empezar una temporada el `adoption_rate` se queda vacío durante semanas, y hay 595 perfiles de la 41 ahí al lado que taparían el hueco. Serían gear de otro reset comparado contra rating de este: la pantalla se llenaría y el dato sería falso. Se declara aquí porque la presión para hacerlo llega justo cuando la web está vacía y nadie se acuerda de este ADR.

## Consecuencias

- **La decisión 1 del GO deja de estar abierta y no vuelve a abrirse cada temporada**, que era el riesgo real de contestarla con una lista.
- **#66 recibe su contrato**: cuota por par `(spec, segmento)` con objetivo 100 y suelo 30, gasto de abajo arriba dentro del ICP, presupuesto declarado bajo prioridad `batch` (regla 4, [ADR 0005](0005-cola-de-peticiones-con-prioridades.md)). Sigue siendo suyo decidir el tamaño de cuota que cabe en el presupuesto y con qué cadencia se refresca.
- **El lanzamiento deja de estar atado a un número de specs y pasa a estarlo a un número de pares servibles.** Cuál es ese mínimo es decisión de #73 (plan de Phase 2), no de este ADR; lo que este ADR fija es que se cuenta en pares y se mide, no se supone.
- **La cobertura servible se mueve durante la temporada** —hacia arriba según madura la ladder, y de golpe hacia abajo en cada reinicio— y hoy no hay nada que lo vigile. Sale de aquí como #74.
- **#58 (qué ve un jugador fuera de cobertura) sube de prioridad.** Con esta decisión, el estado "sin comparación" no es un caso raro de specs marginales: es lo que ve el 100 % de los usuarios en el arranque de una temporada, y en cualquier momento todo el que juegue por encima de 2000. **Cerrada el 22 de agosto de 2026** con el [ADR 0011](0011-fuera-de-cobertura-se-describe-no-se-compara.md).
- **Nada de esto se puede verificar hasta que #66 corra.** Los pares servibles medidos aquí lo son por población de leaderboard; los de gear son 0 en las 40 specs. Este ADR describe cómo se decide la cobertura, no afirma que hoy exista.
