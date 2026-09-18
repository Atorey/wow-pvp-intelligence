# ADR 0032 — La cobertura servible se mide en cada corrida y se guarda por par

**Fecha**: 18 de septiembre de 2026 · **Estado**: aceptada (issue #74)

## Contexto

El [ADR 0010](0010-cobertura-por-segmento.md) decidió que la unidad de cobertura es el par `(spec, segmento objetivo)` y que quien decide es `canShowComparison()` sobre el `gear_sample` del objetivo, no una lista de specs. Su última consecuencia quedó escrita como pendiente: «la cobertura servible se mueve durante la temporada —hacia arriba según madura la ladder, y de golpe hacia abajo en cada reinicio— y hoy no hay nada que lo vigile».

Y se mueve mucho. Medido a mano el 21 de agosto de 2026 ([§12 de findings](../sprint-0-findings.md)), los dos perfiles de cobertura son **inversos**: en la temporada 41, madura, el tope de 5.000 por spec corta el rango bajo del ICP; en la 42, con dos días de vida, el tope no aplica y lo que falta es la parte alta. Contando en cuántas specs el segmento siguiente llega a n≥30, la 42 daba 21 pares servibles desde 1400-1600, 12 desde 1600-1800 y **uno solo** desde 1800-2000.

Esos números salieron de consultas escritas a mano para cerrar #56 y no quedaron guardados en ninguna parte. Es exactamente la forma en que caducó §3 de findings: un número medido contra la fuente real, correcto el día que se escribió, que dos semanas después describía otro mundo sin que nada avisara.

`population_segments` tiene la materia prima —`sample_size` y `gear_sample` por escalón, con su `computed_at`— pero no puede contestar la pregunta, por dos motivos:

1. **El par cruza dos escalones.** Lo que decide un Player Gap es el segmento objetivo, no el del sujeto, y esa relación no existe en una tabla cuya fila es un escalón suelto.
2. **El objetivo vacío no tiene fila.** `refresh-aggregates` no escribe segmentos sin población, a propósito: una fila con n=0 no distinguiría «no hay nadie ahí» de «no lo miramos». Pero eso convierte el hallazgo más importante —«encima de estos 400 sujetos no hay nadie»— en una ausencia, y una ausencia tampoco se distingue de un job que no llegó a correr.

## Decisión

1. **La cobertura se calcula en cada corrida de `refresh-aggregates`** y se escribe en `segment_coverage` dentro de la misma transacción y con el mismo `computed_at` que los segmentos que la producen. No es un job aparte: una cobertura calculada después, con otra ventana, describiría una corrida que no es la publicada.
2. **Una fila por par `(spec, segmento objetivo)`**, con los dos denominadores del objetivo separados: `sample_size` es población y `gear_sample` es base de comparación.
3. **Solo hay fila donde hay sujetos.** Un objetivo poblado sin nadie debajo no le sirve a ningún jugador ([ADR 0010](0010-cobertura-por-segmento.md), decisión 5). El tramo abierto de arriba tampoco emite par: no tiene contra qué compararse.
4. **Un objetivo sin población es un cero escrito, no una fila que falta.** `sample_size = 0`, `gear_sample = 0` y `activity_window_days = null`.
5. **No se guarda el nivel de confianza, se derivan los denominadores al leer** con `confidenceFor()`. Es la lección de #76: `population_segments.confidence` tiene filas `high` con `gear_sample = 0` porque guardó un juicio en vez del número que lo sostiene.
6. **El emparejamiento y la puerta viven en `packages/core`** (`buildCoverage`, `rollUpCoverage`, `isServiceable`), como `servesIcpSubjects`. Quién es el objetivo de quién es la escala de segmentos, y qué se puede servir es `canShowComparison()`: ninguna de las dos cosas es un detalle del job que las usa.
7. **`npm run pipeline -- coverage` lee la serie y no falla nunca.** Que la cobertura se desplome al empezar una temporada no es una avería; la avería sería no verlo. El mínimo de pares servibles con el que se puede lanzar sigue siendo una decisión de producto sin tomar, y convertirla en el `exit 1` de un comando sería tomarla de tapadillo.

## Por qué

**Se guarda porque una consulta ad-hoc no es una medición.** El dato que hacía falta ya se podía calcular en agosto —de hecho se calculó— y aun así el proyecto pasó un mes sin saber cómo se movía. Lo que faltaba no era la consulta, era que quedara escrita con fecha cada día.

**Se cuenta en pares y no en specs** por lo mismo que lo decidió el ADR 0010: «specs con datos» habría dado 33 de 40 en la temporada 42 y habría sonado a cobertura excelente, cuando lo servible por encima de 2000 era cero. La granularidad equivocada convierte un problema de producto en una métrica tranquilizadora.

**Y se cuenta además en personas.** «21 specs servibles» no dice a cuánta gente alcanzan: si las servibles son las que nadie juega, la mitad de las specs puede ser el 5 % de los jugadores. Las dos cifras contestan preguntas distintas y ninguna sustituye a la otra, así que el rollup publica las dos.

**El cero escrito es el dato, no el hueco.** El caso que hay que ver llegar es el del reinicio de temporada, y su forma exacta es «hay sujetos y no hay nadie encima». Si eso se representa con la ausencia de una fila, el día que el job falle la base dirá lo mismo que el día que la ladder se reinicie.

**La confianza se deriva y no se guarda** porque los umbrales son una regla de producto que vive en un único sitio ([ADR 0003](0003-umbrales-de-confianza.md)). Guardar `high` en una columna es fijar el juicio de un día en una fila que va a leerse durante meses, y #76 es lo que pasa cuando además el juicio se toma sobre el denominador equivocado.

## Consecuencias

- **La última consecuencia abierta del ADR 0010 se cierra.** La cobertura deja de ser una foto y pasa a ser una serie, con el corte de temporada visible en ella.
- **`refresh-aggregates` publica una tercera cosa** además de las dos tablas de §28, y su corrida imprime la cobertura del día. El coste es una escritura por lotes de unos cientos de filas dentro de una transacción que ya existía.
- **`segment_coverage` crece con cada corrida** al ritmo de `population_segments` y con el mismo carácter derivado: se puede reconstruir entera desde `character_snapshots`, así que entra en el mismo saco que aquella cuando se decida la política de retención (#48).
- **Queda la cifra que #73 no llegó a fijar**: cuántos pares servibles hacen falta para abrir. Ahora se puede contestar mirando la serie en vez de estimando.
- **Lo que esta serie no vigila es la frescura**, que es [ADR 0031](0031-presupuesto-de-rendimiento-y-observabilidad.md) y `check-freshness`. Son dos preguntas distintas: una corrida puede estar al día y no poder servir a nadie.
