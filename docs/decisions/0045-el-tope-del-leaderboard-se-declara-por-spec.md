# ADR 0045 — El tope del leaderboard se declara por spec, y lo decide lo publicado, no lo observado

**Fecha**: 30 de septiembre de 2026 · **Estado**: aceptada (issue [#128](https://github.com/Atorey/wow-pvp-intelligence/issues/128)) · **Cumple la consecuencia cuarta del [ADR 0038](0038-la-pagina-de-meta-publica-lo-que-la-muestra-sostiene.md)** · Se apoya en el [ADR 0010](0010-cobertura-por-segmento.md) y en el [ADR 0033](0033-la-confianza-se-deriva-no-se-guarda.md)

## Contexto

`/meta/{modalidad}` y la portada reparten la modalidad dividiendo la población de cada spec entre el total de la corrida (`representationFor()`). El leaderboard publica como mucho 5.000 entradas por bracket, que en Solo Shuffle es por spec. Una spec que llena ese tope es una spec de la que vemos la parte alta y no la cola, y su población deja de ser una medida para ser un suelo. El [ADR 0038](0038-la-pagina-de-meta-publica-lo-que-la-muestra-sostiene.md) lo dejó escrito como algo que caducaría solo, y #128 fijó qué hacer cuando llegara: **declararlo en la tabla, no corregirlo**.

La issue ponía la condición de disparo en la **población**: «que la población de un bracket en una corrida se acerque a 5.000». Medido el 20 de septiembre, la spec más poblada tenía 3.514 personajes, y se concluyó que el tope no apretaba.

**Ya apretaba.** La población de `population_segments` cuenta a quien ha jugado dentro de la ventana de actividad, no a quien sale en la lista, y las dos cifras no se parecen. Las entradas de cada publicación están en `leaderboard_fetches.entry_count`, y medidas el 30 de septiembre de 2026 dicen otra cosa:

| Bracket                       | Entradas | En el tope desde |
| ----------------------------- | -------: | ---------------- |
| `shuffle-druid-restoration`   |    5.104 | 28 de septiembre |
| `shuffle-priest-holy`         |    5.046 | 6 de septiembre  |
| `shuffle-warrior-arms`        |    5.044 | 6 de septiembre  |
| `shuffle-rogue-assassination` |    5.028 | 17 de septiembre |
| `shuffle-priest-discipline`   |    5.003 | 5 de septiembre  |
| `shuffle-paladin-retribution` |    5.001 | 6 de septiembre  |

Seis de cuarenta, y la primera desde quince días antes de la medición que decía que no. Las dos siguientes, Beast Mastery y Holy Paladin, están en 4.939 y 4.809. Y el tope no es un techo exacto: una publicación puede pasar de 5.000, así que «llenarlo» es llegar, no clavarlo.

## Decisión

1. **El recorte lo deciden las entradas publicadas, no la población observada.** `isLeaderboardCapped(entries)` en `packages/core`, con `LEADERBOARD_CAP = 5_000`: una publicación con 5.000 entradas o más está recortada. `null` —no se sabe cuántas trajo— no se da por recortado.
2. **La cifra se copia a la corrida.** `population_segments.leaderboard_entries` (migración 0026) guarda las entradas de la última publicación del bracket que se descargó bien antes de calcular, igual en todas las filas del bracket. La escribe `refresh-aggregates`, que la lee de `leaderboard_fetches`.
3. **Se guarda el número, no el juicio.** Nada de una columna `capped`: «recortada» se deriva al leer, por lo mismo que se quitó `confidence` ([ADR 0033](0033-la-confianza-se-deriva-no-se-guarda.md)).
4. **La tabla lo declara por spec.** La fila de una spec en el tope lleva la marca «tope del leaderboard», y una nota bajo la del reparto nombra a todas las de la corrida, también las que no caben en el recorte de la portada, y dice qué deja de significar la cifra. Sin ninguna en el tope, la nota no se pinta.
5. **No se corrige nada.** La proporción sigue siendo la de lo observado. Estimar la cola sería inventar población que nadie ha observado.
6. **La página de spec lo dice en su cifra.** La tarjeta de observados lleva una nota cuando la spec está en el tope, con la misma condición que el puesto: solo si sale de la misma corrida que el total.

## Por qué

**Porque el dato que decide es el de la lista, y la población es otra cosa.** El recorte ocurre en la lista: lo que no cabe en las 5.000 entradas no llega ni a la ingesta. Que después solo 3.800 de esas 5.000 hayan jugado en la ventana no quita el recorte, lo esconde. La condición que proponía la issue no se habría cumplido nunca en una spec como Disc Priest mientras el reparto ya estaba sesgado.

**Porque una sola fecha.** Si la web leyera `leaderboard_fetches` directamente, declararía el estado de la publicación de las tres de la tarde sobre la población de la corrida de las cuatro de la madrugada. Copiado a la corrida, lo que se declara es lo que vio esa corrida y nada más. Y `leaderboard_fetches` sigue siendo lo que su migración prometió: bitácora del pipeline, que el producto no consulta.

**Porque no hay consulta nueva.** La cifra entra en `readRunPopulation`, la lectura que ya piden la portada, `/meta` y las páginas de spec ([ADR 0038](0038-la-pagina-de-meta-publica-lo-que-la-muestra-sostiene.md), decisión 9). La columna es nullable y sin default, así que añadirla no reescribe la tabla.

**Porque «suelo» es lo que se puede afirmar, y no más.** La población de una spec en el tope es como mínimo la observada, sin duda. Su **proporción** no tiene dirección cierta en cuanto hay varias en el tope: depende de cuánta cola le falte a cada una, y eso es justo lo que no vemos. Por eso la nota llama suelo a los observados y de las proporciones solo dice que se calculan sobre lo que se ve, sin corregir.

**Porque la marca va en la spec, no en la cifra.** Un «≥» delante de los observados diría «hemos observado al menos 4.300», y lo observado es exacto: lo que es un suelo es la población. La marca va junto al nombre, que además es la única columna que no se retira en pantalla estrecha.

## Consecuencias

- **La página cambia en cuanto corra `refresh-aggregates` con la migración 0026 aplicada.** Con los datos de hoy, seis specs llevarán la marca y la nota. Las corridas anteriores tienen la columna a `null` y no afirman nada.
- **El log de `refresh-aggregates` lo dice por bracket**, junto a la población del día. No hace falta vigilarlo a mano, y tampoco hace falta hacerlo en `coverage`: lo que mide la cobertura es otra cosa.
- **El tope está en dos sitios que no se pueden separar**: la constante de core y la frase del copy, que lo escribe a mano porque `Intl` no agrupa los millares en español. Un test de `copy.test.ts` comprueba que coinciden.
- **La frase general del pie se queda.** Dice dónde está el corte para todas las specs; la nota nueva dice cuáles lo tocan en esta corrida.
- **Un día puede apretar al revés.** Al empezar una temporada lo que falta es la parte alta, no la cola ([§12 de findings](../sprint-0-findings.md)). Esa ausencia no la mide el tope, y este ADR no la declara.
