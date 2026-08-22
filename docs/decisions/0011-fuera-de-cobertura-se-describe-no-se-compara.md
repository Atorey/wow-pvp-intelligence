# ADR 0011 — Fuera de cobertura se describe la población, nunca se sustituye la comparación

**Fecha**: 22 de agosto de 2026 · **Estado**: aceptada (issue #58) · **No sustituye a ningún ADR**; fija el disparador de revisión del punto 8 del [ADR 0007](0007-agregados-por-segmento.md)

## Contexto

El [ADR 0003](0003-umbrales-de-confianza.md) dice qué hacer cuando no hay muestra: no enseñar la comparación y explicar por qué. El [brief de diseño](../design/brief.md#15-los-tres-estados-de-confianza) dibujó esa explicación dentro de la caja Player Gap y dejó un hueco marcado —`[qué más se le ofrece → #58]`— porque una caja que explica su propio vacío no es una página.

Lo que convierte ese hueco en el problema central es el tamaño del caso. Medido el 22 de agosto de 2026 ([§13 de findings](../sprint-0-findings.md)):

- **`gear_sample = 0` en las 439 filas** de la corrida diaria de la temporada vigente. También `item_level_sample` y `talent_sample`. No hay ni una mediana de item level que pintar.
- **20.293 de los 23.768 pares `(personaje, bracket)` observados (85,4 %) tienen el segmento objetivo poblado a n≥30, y 0 tienen Player Gap.**
- Un Holy Priest a 1650 —el bracket mejor poblado— tiene 474 personajes en su segmento, 285 en el de arriba, y cero perfiles en ambos.

Es decir: **el estado vacío no es el borde del producto, es el producto el día del lanzamiento**, y vuelve a serlo en cada reinicio de temporada ([ADR 0010](0010-cobertura-por-segmento.md)). Y no es un problema de población —la población está y sube sola— sino de perfiles, que es #66.

Eso deja dos tentaciones a la vez, y las dos llenarían la pantalla:

1. **Sustituir el objetivo** por el segmento servible más cercano hacia arriba, en vez de por el inmediato.
2. **Relajar el umbral** o rellenar con la temporada anterior, que ya están prohibidos ([ADR 0003](0003-umbrales-de-confianza.md), decisión 6 del [ADR 0010](0010-cobertura-por-segmento.md)) pero cuya presión llega justo ahora.

Y deja una pregunta pendiente heredada: el punto 8 del [ADR 0007](0007-agregados-por-segmento.md) dejó `source = 'search'` fuera del denominador **contando la población excluida en `excluded_search` para poder revisarlo con dato delante**. El dato ya está mirado: `excluded_search = 0` en las seis corridas que existen, y en toda la base de datos hay 3 snapshots de búsqueda, de 2 personajes, los tres de la temporada anterior.

## Decisión

1. **Fuera de cobertura, la página describe; no compara.** La caja Player Gap mantiene su sitio con la explicación de [§1.5 del brief](../design/brief.md#15-los-tres-estados-de-confianza), y el resto de la página lo ocupa la **capa descriptiva**, que no es una comparación degradada: es un recuento sobre población enumerada.
2. **La capa descriptiva son cuatro cosas, y ninguna necesita el perfil de un tercero**: (a) los datos del propio jugador, que salen de su propia consulta on-demand; (b) su posición dentro de la población observada de su bracket; (c) el tamaño de su segmento y el del objetivo; (d) qué falta, por cuál de las dos causas y qué lo desbloquea.
3. **La capa descriptiva no pasa por `canShowComparison()`**, porque no hay inferencia que respaldar: contar cuántos personajes observados están por debajo de un rating no estima nada sobre una población mayor. Lo que sí hereda de la caja: **toda cifra sale con su denominador crudo pegado** (§1.7 del brief).
4. **El percentil es una etiqueta derivada, y solo se añade cuando el bracket completo llega a `MIN_SAMPLE_MEDIUM`.** Por debajo se enseña la fracción y no el porcentaje: "3 de 6 observados" es honesto, "percentil 50" no. No se inventa un umbral nuevo — es el que ya vive en [confidence.ts](../../packages/core/src/confidence.ts).
5. **La población que se describe es la misma que la de los agregados**, con las mismas exclusiones (punto 8 del [ADR 0007](0007-agregados-por-segmento.md)). Una página no puede tener dos poblaciones distintas según el bloque que la pinte.
6. **Se dice siempre "observados", nunca "jugadores"**. La base es quien ha aparecido en el leaderboard o ha sido consultado, no el censo de la región.
7. **No se sustituye el segmento objetivo por otro servible.** Si el inmediato no llega, no hay comparación: ni contra el siguiente que sí llegue, ni contra el top, ni contra el propio segmento.
8. **No entra captación** (email, cuentas, "avísame cuando haya datos") en el MVP: §25 la excluye, y convertiría el estado vacío en un formulario.
9. **Indexabilidad, para [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)**: una página cuyo único contenido es la explicación de por qué no hay comparación **no se indexa**. La capa descriptiva por sí sola tampoco la hace indexable: las reglas anti-thin-content las fija #26, y lo que este ADR le entrega es el suelo —sin comparación y sin población propia declarada, no hay página que indexar.
10. **El punto 8 del ADR 0007 se mantiene, con disparador declarado.** La exclusión de `source = 'search'` se revisa —con ADR nuevo— cuando en una corrida diaria exista **al menos un par `(bracket, segmento)` con `excluded_search >= MIN_SAMPLE_MEDIUM` y `gear_sample < MIN_SAMPLE_MEDIUM`**: población excluida bastante para servir algo que hoy no se sirve. Hasta entonces no se revisa. Vigilarlo es alcance de [#74](https://github.com/Atorey/wow-pvp-intelligence/issues/74); si #74 no mide `excluded_search`, no hay disparador y hay que añadirlo ahí.

## Por qué

**Porque la alternativa honesta a una comparación no es otra comparación: es una descripción.** Las dos son números sobre la misma población, pero se sostienen en cosas distintas. El `adoption_rate` es una estimación sobre una muestra, y por eso necesita n≥30. "1.598 de los 2.282 Holy Priest observados están por debajo de ti" es un recuento sobre lo que hemos visto: no mejora ni empeora con el tamaño de la muestra, describe otra cosa. Meterlo bajo el mismo umbral sería aplicar una regla estadística a algo que no es una inferencia, y dejaría la página vacía sin ganar un gramo de rigor.

**Y porque hay bastante que decir sin un solo perfil.** El 85,4 % de los personajes observados tiene el segmento de arriba poblado: sabemos cuánta gente hay, dónde cae el sujeto dentro de su spec y cuánta gente le separa del escalón. Eso no es Player Gap y no se puede presentar como si lo fuera, pero tampoco es una pantalla de error.

**Sustituir el objetivo es cambiar la promesa sin decirlo.** El caso peligroso no es comparar hacia abajo, es saltar al primer tramo poblado hacia arriba: la caja seguiría diciendo "qué te separa del siguiente escalón" mientras el dato dice otra cosa. En la temporada 42, para 9 de los 25 brackets con 1600-1800 poblado, ese "siguiente escalón servible" está dos o tres tramos más arriba — una comparación contra gente 400 puntos por encima, presentada como el paso inmediato. El producto entero existe para no hacer eso.

**El disparador en vez de la revisión** porque revisar hoy es decidir sin el dato que la propia decisión reservó. `excluded_search = 0` no significa que la exclusión salga barata: significa que el tráfico que la haría cara no existe todavía. Fijar la condición ahora tiene la ventaja de que se escribe sin presión — el día que la haya, la página estará vacía y el argumento para levantar la exclusión será "así se llena", que es exactamente el argumento que no vale.

**Y conviene dejar anotado que la exclusión es más cara de lo que parecía.** Los snapshots de búsqueda **traen gear** ([lookup-character.ts](../../apps/pipeline/src/jobs/lookup-character.ts)), así que el punto 8 del ADR 0007 no deja fuera solo rating del tramo que el leaderboard no cubre en temporada madura: deja fuera el único gear que el tráfico puede aportar ahí. No cambia la decisión —el sesgo de selección sigue siendo real, y el `n` que sostiene la confianza declarada no puede llevarlo dentro— pero sube lo que hay en juego cuando salte el disparador. Por eso el disparador mira las dos columnas juntas y no solo `excluded_search`.

**"Observados" y no "jugadores"** porque es la mentira más fácil de esta pantalla y la más difícil de retirar después. La población observada de un bracket depende del tope del leaderboard, del punto de la temporada y de a quién haya buscado alguien. "Estás por encima del 70 % de los Holy Priest" es falso; "por encima de 1.598 de los 2.282 observados esta temporada" es verdad y ocupa lo mismo.

## Consecuencias

- **[#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18), [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19) y [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) quedan desbloqueadas.** El layout concreto —qué bloque va dónde y qué dice cada hueco— está en [§2 del brief](../design/brief.md).
- **La capa de lectura ([#61](https://github.com/Atorey/wow-pvp-intelligence/issues/61)) tiene un consumidor que no se esperaba**: además del agregado del segmento objetivo, necesita **la distribución completa del bracket** para situar al sujeto. Sale de `population_segments` sin trabajo nuevo, pero son todas las filas del bracket, no una.
- **La posición del sujeto necesita una función nueva en `packages/core`**, con su denominador y su umbral, para no acabar siendo un `if` suelto en la web (regla 2 del proyecto). No sirve la que hay: [`percentile()`](../../packages/core/src/stats.ts) da el valor que ocupa un percentil dado, y aquí hace falta lo contrario —el percentil que ocupa un rating dado dentro de la distribución del bracket—, además del recuento crudo que lo acompaña.
- **#66 sigue siendo el prerrequisito real del MVP.** Esta decisión hace presentable el día 1; no lo convierte en el producto. El punto 6 de §25 del plan —"un grupo real encuentra valor"— no se puede demostrar con la capa descriptiva sola.
- **El % de visitas que acaban sin comparación deja de ser solo métrica de salud del dato (§35 del plan) y pasa a ser la que dice si el MVP está listo.** Hoy es 100 %.
- **Queda declarada una asimetría incómoda**: cuando un usuario se busca a sí mismo, su snapshot entra como `source = 'search'` y el producto lo excluye del mismo denominador que le acaba de decir que está vacío. Es coherente con el ADR 0007 y con la decisión 5 de aquí, y es justo lo que el disparador vigila.
