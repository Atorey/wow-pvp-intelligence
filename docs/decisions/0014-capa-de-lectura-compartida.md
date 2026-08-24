# ADR 0014 — La web lee con RSC directo, por una capa que no sabe devolver una cifra sin su denominador

**Fecha**: 22 de agosto de 2026 · **Estado**: aceptada (issue [#61](https://github.com/Atorey/wow-pvp-intelligence/issues/61)) · **Extiende el [ADR 0001](0001-estructura-del-repo-y-stack.md)** con un paquete que no estaba previsto, y cierra la fila "Backend" de §29 del plan para la lectura. No toca la escritura ni el [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)

## Contexto

La web necesita leer lo mismo que ya lee el pipeline, y hay dos cosas que decidir antes de escribir la primera consulta: **cómo llega la web a Postgres** y **quién es el dueño de la SQL**.

Sobre lo primero, §29 avisa contra la sobrearquitectura: una API interna solo cuando haya un consumidor externo que la justifique. El ADR 0013 ya dejó a la web ejecutando funciones serverless que llaman a Blizzard de forma síncrona, así que una capa HTTP intermedia sería un salto de red entre dos procesos que ya están en el mismo sitio.

Sobre lo segundo, el reparto actual no sirve tal cual. `packages/core` es dominio puro sin dependencias y esto necesita hablar con Postgres. Y la SQL que hay en `apps/pipeline` **no es la que necesita la web**: la de [player-gap.ts](../../apps/pipeline/src/jobs/player-gap.ts) carga una población cruda de un run muestreado, con el manifiesto en disco, y la de [refresh-aggregates.ts](../../apps/pipeline/src/jobs/refresh-aggregates.ts) carga población para calcular. La web lee otra cosa: escalones ya calculados. Así que no hay tanto que mover como que escribir por primera vez, y por eso conviene decidir ahora dónde vive.

Hay además una restricción que no es de estructura sino de producto. El principio 8 (§9) —"cada insight trazable a un dato concreto"— y §13.5 —el tamaño de muestra pegado a cada cifra, no en una nota al pie— hoy se cumplen **porque el único consumidor es un job que renderiza markdown y se acuerda**. En cuanto haya páginas, se cumplen o no según lo que devuelva esta capa.

Y una trampa concreta esperando ahí: [#76](https://github.com/Atorey/wow-pvp-intelligence/issues/76) midió que `population_segments.confidence` tiene **59 filas guardadas como `high` con `gear_sample = 0`**. La columna mide población, no base de comparación. Es el nombre más creíble de la tabla y es la respuesta equivocada a "¿puedo enseñar esta comparación?".

## Decisión

1. **La web lee con RSC directo contra Postgres. No hay API interna.** Se levantará cuando exista un consumidor que no sea la propia web —una app, un tercero, un endpoint público—, y entonces se construirá sobre esta misma capa, no en su lugar.

2. **Existe `packages/data`**, con `pg` como única razón de no vivir en `core`. Depende de `@wowpvp/core`; nunca al revés.

3. **Solo lecturas de servicio.** Lo que una página necesita para pintarse. Las escrituras se quedan en `apps/pipeline/src/db`, y las consultas de cálculo de los jobs también: sirven a un job, no a una pantalla, y mezclarlas volvería a atar la web a la cadencia del pipeline.

4. **El paquete no abre conexiones: recibe un ejecutor** (`Queryable`, una interfaz con un solo método). El ADR 0013 obliga a la web al pooler de Supabase en modo transacción y al pipeline le conviene un `pg.Pool` largo; si esta capa eligiera, uno de los dos tendría que saltársela — que es el incentivo exacto que hace aparecer consultas duplicadas fuera del paquete. `pg.Pool` y `pg.PoolClient` la cumplen por estructura, sin adaptador y sin que el paquete dependa de `pg`.

5. **Ninguna cifra agregada sale sin su `Provenance`**: `computedAt`, `sampleSize`, `denominator` y `confidence`, en el tipo. No hay función que devuelva un porcentaje suelto.

6. **`confidence` no se lee de la base de datos: se deriva.** `provenanceFor()` es la única forma de construir una `Provenance` y no acepta `confidence` como parámetro — la calcula con `confidenceFor()` de `packages/core` sobre el denominador de esa cifra. La lista de columnas de la consulta es explícita y no incluye `confidence`, con un test que lo comprueba sobre la SQL emitida.

7. **Un escalón tiene cuatro procedencias, no una**: población, gear, talentos e item level. Cada una con su denominador, porque son cuatro bases que difieren en órdenes de magnitud, y la que suena a respuesta —la población— es justo la que no lo es para una comparación ([ADR 0010](0010-cobertura-por-segmento.md), punto 3).

8. **Una adopción se lee pasando el escalón, no un identificador de fila.** `readAdoption(db, segment, kind)`. Así no existe la ruta que devuelve un `adoption_rate` sin el `computedAt` y el denominador de su escalón.

9. **Una observación individual lleva `ObservationProvenance`** —`observedAt` y `source`—, **no `Provenance`**. Es el dato de una persona, no una estimación sobre una población: no hay muestra que declarar. `source` va pegado porque cambia lo que significa el número ([ADR 0008](0008-ventana-de-actividad-por-partidas-jugadas.md)).

10. **`null` distingue "no existe" de "no llega al umbral".** Un escalón nunca calculado devuelve `null`; uno calculado con muestra insuficiente devuelve fila con `confidence: 'insufficient'`. Es lo que permite explicar por qué no hay comparación en vez de servir una página en blanco ([ADR 0011](0011-fuera-de-cobertura-se-describe-no-se-compara.md)).

11. **La posición dentro de la población (`readStanding`) se cuenta sobre observados de la temporada, sin ventana de actividad**, y con la misma exclusión de `source = 'search'` que los agregados ([ADR 0007](0007-agregados-por-segmento.md), punto 8). Es un recuento, no una inferencia: no pasa por `canShowComparison()`, y el percentil solo aparece por encima de `MIN_SAMPLE_MEDIUM` (ADR 0011, punto 4).

12. **El paquete no formatea ni traduce.** Devuelve datos y fechas; el copy y el idioma son de la web ([ADR 0012](0012-producto-bilingue.md)).

13. **El pipeline no se migra ahora.** `refresh-aggregates` y `player-gap` se quedan como están.

## Por qué

**Porque una API interna aquí solo añadiría un salto de red entre dos cosas que ya corren juntas.** La web del ADR 0013 son funciones de Netlify: procesos de Node con acceso a la base de datos. Poner HTTP en medio significaría serializar, deserializar y gastar parte del presupuesto de 8 segundos en hablar consigo misma, a cambio de una separación que no separa nada — el mismo repo, el mismo despliegue, el mismo equipo de una persona. La separación que sí hace falta es que la SQL viva en un sitio, y esa la da el paquete, no el protocolo. Y cuando aparezca el consumidor externo, la capa que necesitará ya estará escrita: la API se montará **encima** de `packages/data`, así que aplazarla no cuesta trabajo tirado.

**Porque el requisito de trazabilidad no se cumple con una convención, y ya sabemos cómo se incumple.** "Que el frontend nunca muestre un número sin poder trazar de dónde sale" lleva escrito desde §28 y hoy se cumple porque el único consumidor es un job que renderiza markdown con la plantilla fija de §13.6. Esa garantía no sobrevive a la primera pantalla que necesite un dato para un `<meta>` de SEO. La forma de que sobreviva no es repetirlo en un README: es que la función que devuelve el porcentaje devuelva también el denominador, siempre, y que la que lee adopciones necesite el escalón para funcionar. El coste es un parámetro más; el beneficio es que la omisión deja de ser posible.

**Porque `confidence` es la puerta de al lado por la que se cuela lo que el ADR 0010 prohíbe.** Con la columna en el tipo, un segmento de 3.000 personas y cero perfiles llegaría a la web etiquetado como `high`, y nadie leyendo el código de la página tendría motivo para sospechar: el campo se llama exactamente como la pregunta que responde. El ADR 0007 ya separó `gear_sample` de `sample_size` por esto mismo, y el ADR 0010 decidió cuál de los dos manda. Lo que faltaba era que **al leer** no hubiera manera de coger el otro. Derivarla en vez de copiarla lo consigue sin migración: `#76` sigue teniendo que arreglar la columna para el resto del sistema, pero deja de bloquear a la web.

**Porque cuatro procedencias no es verbosidad, es lo que mide la tabla.** La tentación de tener un solo `confidence` por escalón es fuerte y es exactamente el error de #76 a otra escala. En agosto de 2026 los cuatro denominadores del mismo escalón eran 3.000, 0, 0 y 0. Colapsarlos obligaría a elegir uno como "el" denominador del escalón, y cualquier elección sería falsa para tres de las cuatro cifras que cuelgan de él.

**Porque una observación individual con `sampleSize: 1` sería una mentira educada.** Es la tentación de que todo tenga la misma forma. Pero un snapshot no estima nada: darle una confianza `insufficient` lo presentaría como una comparación mala cuando no es una comparación. El ADR 0011 separa por este mismo motivo la capa descriptiva de la comparativa, y esa separación tiene que existir también en los tipos o la web volverá a mezclarlas.

**Porque recibir el ejecutor es lo único que deja convivir a los dos consumidores sin excepciones.** Un `pg.Pool` por invocación agotaría el techo de conexiones de Postgres bastante antes que el de invocaciones concurrentes de Netlify; un cliente de pooler en un proceso largo sería peor que el pool que ya tiene el pipeline. Cualquier decisión tomada dentro del paquete condenaría a uno de los dos a saltárselo, y un consumidor que se salta la capa compartida es un consumidor con su propia copia de la SQL — el problema que este ADR existe para evitar.

**Porque migrar el pipeline hoy sería riesgo sin consumidor.** No hay web todavía, así que la migración no validaría el diseño: solo tocaría dos jobs que funcionan. Y su SQL no es la de servicio — es de cálculo, con ventanas de actividad y `distinct on` que existen para agregar, no para pintar. Moverla ahora metería en la capa de lectura de la web código que la web nunca va a llamar.

## Consecuencias

- **`packages/data` nace sin consumidor y eso es deliberado, pero tiene fecha de caducidad.** Si [#62](https://github.com/Atorey/wow-pvp-intelligence/issues/62) y [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) no lo consumen, el diseño no se habrá validado nunca. La primera página que se monte es la revisión real de este ADR.
- ~~**No hay test contra el schema.**~~ El ejecutor falso prueba el mapeo y qué SQL se emite, no que las columnas existan: un `rating_p25` mal escrito pasa el typecheck y los tests, y falla en la primera consulta real. **Cerrado el 24 de agosto de 2026** por [#64](https://github.com/Atorey/wow-pvp-intelligence/issues/64) ([ADR 0018](0018-dataset-de-desarrollo.md)): todas las lecturas de este paquete se ejecutan contra una Postgres migrada y sembrada, en CI. Lo que sigue sin cubrirse es la web, que todavía no existe.
- **[#76](https://github.com/Atorey/wow-pvp-intelligence/issues/76) deja de bloquear a #61, pero no se cierra.** La columna sigue mintiendo para cualquiera que la lea por fuera de este paquete —un `psql` a mano, un job futuro, un dashboard— y las filas ya escritas siguen teniendo el significado viejo. Lo que cambia es que la web ya no puede tropezar con ella.
- **Aparece una regla que hay que sostener a mano**: `SEGMENT_COLUMNS` es una lista explícita, y añadir `confidence` a ella sería un `select` de una línea que rompe la garantía. Lo cubre un test sobre la SQL emitida, que es lo más cerca que se puede estar de impedirlo sin un ORM.
- **`readStanding` no lleva ventana de actividad, y eso hay que decirlo en la página.** El número que devuelve es "cuánta gente hemos observado esta temporada", no "cuánta está activa". Es lo que pide la palabra "observados" del ADR 0011, pero significa que el percentil de un jugador no baja cuando la gente deja de jugar. Qué palabras exactas lo declaran es de #17.
- **Queda sin decidir, y a propósito, la caché.** §29 contempla Redis para resultados recientes y aquí no entra nada: los agregados ya están materializados y una función serverless no tiene dónde guardar una caché en memoria que sobreviva. Cuando [#72](https://github.com/Atorey/wow-pvp-intelligence/issues/72) mida el presupuesto de rendimiento con páginas reales delante, esa es la conversación — y el sitio donde entraría es este paquete.
- **El día que haya API interna, este ADR no se revisa: se extiende.** La decisión 1 dice cuándo, no dice "nunca", y la API se montaría sobre la misma capa. Lo que sí habría que revisar es si `packages/data` sigue siendo el sitio de las lecturas o pasa a serlo el servicio.
