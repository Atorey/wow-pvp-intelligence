# ADR 0033 — La confianza se deriva del denominador; ninguna tabla la guarda

**Fecha**: 18 de septiembre de 2026 · **Estado**: aceptada (issue #76; cierra la mitad que el [ADR 0014](0014-capa-de-lectura-compartida.md) dejó abierta y generaliza el punto 5 del [ADR 0032](0032-cobertura-servible-medida-de-forma-continua.md))

## Contexto

`population_segments` nació en la migración 0005 con una columna `confidence`. Se escribía como `confidenceFor(sample_size)` —es decir, desde la población— y se llamaba exactamente como la pregunta que **no** contestaba: «¿puedo enseñar esta comparación?».

Medido contra producción el 20 de agosto de 2026 (EU, agregados del día):

| `confidence`   | filas | población | `gear_sample` |
| -------------- | ----: | --------: | ------------: |
| `high`         |    59 |     8.036 |         **0** |
| `medium`       |   298 |    15.909 |             0 |
| `insufficient` | 1.067 |     7.543 |             0 |

**59 filas guardadas como `high` sin un solo perfil con el que comparar.** Es el error que el [ADR 0007](0007-agregados-por-segmento.md) evitó separando `gear_sample` de `sample_size` y que el punto 3 del [ADR 0010](0010-cobertura-por-segmento.md) zanjó eligiendo cuál de los dos manda, colándose por la puerta de al lado con el nombre más creíble de la tabla.

De las dos mitades del problema, la de lectura ya está resuelta. El [ADR 0014](0014-capa-de-lectura-compartida.md) (decisión 6) hizo que `provenanceFor()` no acepte la confianza como parámetro y que la lista de columnas de `packages/data` sea explícita y no la incluya, con un test sobre la SQL emitida. Hoy **nadie** lee esa columna: ni la web, ni `packages/data`, ni `check-freshness`. El único que la tocaba era el `insert` de `refresh-aggregates`.

Queda entonces una columna que solo se escribe, que nadie lee y que sigue pareciendo la respuesta a la pregunta equivocada. Y ya hay un precedente de cómo se resuelve: la migración 0017 decidió para `segment_coverage` no guardar el juicio sino el número que lo sostiene, citando estas mismas filas.

## Decisión

1. **La columna `population_segments.confidence` se elimina** (migración 0018). No se renombra a `population_confidence`: su valor es una función pura de `sample_size`, que sigue en la misma fila, así que borrarla no pierde ningún dato.
2. **Ninguna tabla guarda un nivel de confianza.** Se guardan los denominadores —`sample_size`, `gear_sample`, `talent_sample`, `talent_node_sample`, `pvp_talent_sample`, `item_level_sample`— y la confianza se deriva al leer con `confidenceFor()` ([ADR 0003](0003-umbrales-de-confianza.md)). Generaliza a todo el schema lo que el punto 5 del ADR 0032 decidió para una tabla.
3. **`summarizeSegment()` deja de devolver `confidence`.** El tipo que cruza de `packages/core` al pipeline llevaba un `sampleSize` y un `confidence` juntos sin decir cuál de los cinco denominadores del mismo objeto lo sostenía: es la forma que tenía el error de llegar hasta el `insert`.
4. **Las dos confianzas siguen existiendo y siguen siendo dos.** La de población sale de `sample_size` y sostiene el percentil y el ranking, que no necesitan perfil ([ADR 0011](0011-fuera-de-cobertura-se-describe-no-se-compara.md), punto 2b); la de comparación sale del denominador de cada cifra y decide si el Player Gap se enseña. Lo que desaparece es la que no distinguía entre ambas.
5. **Las filas viejas no se migran ni se anotan: dejan de existir como tales.** Al caer la columna, no queda ningún dato escrito con el significado ambiguo, así que la serie histórica de `population_segments` no tiene aquí un antes y un después que declarar — al contrario que `leaderboard_fetches.changed` en el [ADR 0009](0009-ingesta-por-cambio-de-poblacion.md), donde lo que cambió fue el criterio de qué se escribía.

## Por qué

**Porque guardar un juicio derivable es tener dos fuentes para el mismo número.** Los umbrales de confianza son una regla de producto que vive en un único sitio y puede cambiar. Cada `high` escrito en una fila es ese juicio congelado el día del recálculo, capaz de contradecir a la función que lo define en cuanto alguien toque `confidenceFor()`. El denominador no tiene ese problema: 47 personas son 47 personas en agosto y en diciembre, y qué significan es una pregunta que se contesta al leer.

**Porque se quita en vez de renombrarse.** `population_confidence` habría sido honesta y habría sobrevivido a la siguiente lectura distraída —el nombre ya no promete lo que no da—, pero deja en pie la duplicación del párrafo anterior y conserva una columna que nadie lee. Renombrar arregla el nombre; borrar arregla la categoría de error, que es lo que pedía el issue: que **no exista** forma de leer una confianza de comparación desde esa tabla.

**Porque el riesgo no era teórico y el mes siguiente lo demuestra.** La columna nació mal el 19 de agosto y se descubrió seis días después, al verificar contra el código lo que afirmaba el ADR 0010 (#56). Desde entonces, tres decisiones posteriores tuvieron que esquivarla explícitamente: el ADR 0014 al leer, el [ADR 0029](0029-que-se-indexa-y-que-no.md) al elegir qué se indexa —un índice construido sobre ella habría publicado cientos de páginas vacías con su confianza declarada mintiendo— y el ADR 0032 al diseñar `segment_coverage`. Una trampa que hay que rodear tres veces se quita.

**Y porque la alternativa de dejarlo como estaba tenía fecha de caducidad.** Hoy no la lee nadie porque `packages/data` es joven y su regla está fresca. La garantía la sostienen una lista de columnas escrita a mano y un test sobre una cadena de SQL; funcionan, pero protegen de un `select` distraído, no de alguien que abra la tabla en un cliente de Postgres para decidir si un segmento se puede enseñar.

## Consecuencias

- **`packages/data` no cambia ni una línea de comportamiento.** Ya derivaba. Lo que cambia es que su regla deja de ser la única barrera: el test de `SEGMENT_COLUMNS` pasa a ser defensa en profundidad de algo que la base ya no puede ofrecer.
- **El log de `refresh-aggregates` dice ahora de qué confianza habla.** Imprime la de población —derivada al vuelo— y lo etiqueta, porque el gear de la misma línea tiene su propia base y casi nunca coincide.
- **Una consulta a mano sobre `population_segments` ya no puede contestar «¿se puede comparar?» sin nombrar un denominador.** Es el objetivo, no un efecto secundario.
- **Queda una mención histórica en la migración 0017**, que cita la columna para explicar por qué `segment_coverage` no la tiene. No se toca: un archivo aplicado no se edita, y el motivo sigue siendo el correcto aunque el ejemplo ya no exista.
- **Si algún día hace falta saber qué umbral se aplicó un día concreto**, se responde con el denominador guardado y la versión de `confidenceFor()` en git, no con una columna. Cambiar los umbrales pasa a reinterpretar el histórico entero de forma coherente, que es lo que se quiere de una regla de producto.
