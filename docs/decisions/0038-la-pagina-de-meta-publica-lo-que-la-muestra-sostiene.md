# ADR 0038 — `/meta/{modalidad}` se abre con cuatro de las cinco señales, y las dos que faltan se declaran

**Fecha**: 20 de septiembre de 2026 · **Estado**: aceptada (issue [#29](https://github.com/Atorey/wow-pvp-intelligence/issues/29)) · **Revisa la decisión 5 del [ADR 0020](0020-mapa-de-rutas-del-sitio.md)**, que dejó esta ruta declarada y sin código · **Hereda la medición del [ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md)**

## Contexto

La §17 del plan define el meta con una fórmula de cinco señales —`representation`, `rating_distribution`, `high_rating_representation`, `activity` y `trend`— y con una prohibición explícita: no es una tier list estática, y no hay letras S/A/B/C. La §26 le da MVP+.

Tres de esas cinco ya están calculadas y en pantalla, y eso cambia lo que queda por decidir:

- **`representation` y `high_rating_representation`** las calcula `representationFor()` desde [#96](https://github.com/Atorey/wow-pvp-intelligence/issues/96) y las pinta la portada, con el índice entre las dos y con `canShowComparison()` decidiendo quién publica las de arriba. El cuerpo de [#29](https://github.com/Atorey/wow-pvp-intelligence/issues/29) decía que no existían en ninguna parte del código; dejó de ser cierto dos días antes.
- **`rating_distribution`** es la tabla por tramo de la página de spec, una spec cada vez.
- Lo que la portada **no** puede dar es el conjunto: enseña ocho filas de cuarenta porque es una portada, y la comparación entre specs es precisamente lo que pide una página propia.

Las otras dos no llegan, y por razones distintas:

**`trend` no tiene muestra.** El [ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md) lo midió el mismo día: 666 personajes por encima de `HIGH_RATING_FLOOR` repartidos en 40 specs, 57 en la más poblada, contra el n≥100 que la §17 exige para declarar una tendencia. Y el criterio anti-FOTM pide ≥2 ventanas consecutivas, o sea tres corridas que existan, con un hueco real de quince días en la serie.

**`activity` no tiene de dónde salir sin renombrar otra cifra.** `population_segments.sample_size` se calcula filtrando por `character_activity.last_active_at`, así que la columna «Observados» **ya es** personajes activos por spec dentro de la ventana. Lo que la §17 pide es volumen de partidas, y eso solo se puede sostener con la variación del contador del leaderboard consigo mismo ([ADR 0008](0008-ventana-de-actividad-por-partidas-jugadas.md)): `character_activity` guarda `last_played`, no la suma de deltas de la ventana, así que hoy no se agrega leyendo.

## Decisión

1. **Se abre `/meta/{modalidad}`**, y con ella la decisión 5 del [ADR 0020](0020-mapa-de-rutas-del-sitio.md) deja de aplicarse a esta ruta. Las otras cuatro que aquel punto enumera —`/compare`, `/rankings`, `/trends` y la ya abierta `/privacy`— siguen como estaban.
2. **La modalidad es un tramo de ruta y no una query**: `/meta/solo-shuffle`, con `metaPath()` y `resolveMetaRoute()` en `packages/core` como todo el mapa. Hoy el catálogo tiene un miembro, así que `/meta` a secas **no existe**: sería una segunda URL con el mismo contenido.
3. **La página publica cuatro señales**: el reparto de las cuarenta specs, su proporción en el tramo alto, el índice entre las dos y el **tramo mediano** de cada spec, que es `rating_distribution` dicha en una celda.
4. **La mediana se calcula una sola vez, en `packages/core`.** `medianSegmentOf()` recibe la distribución por tramo y devuelve el tramo donde la población acumulada cruza la mitad. La página de spec deja de tener la suya: dos medianas que se calculan aparte acaban discrepando en un borde y nadie se entera.
5. **Las dos señales que faltan se declaran con su razón, y no se rellenan.** La tendencia dice cuánta muestra le falta arriba; la actividad dice que el volumen de partidas no se puede agregar hoy y por qué la cifra que sí hay no es esa. Es la §1.5 del brief: lo que falta se dice con palabras.
6. **Ninguna letra, ningún orden que no sea la población.** La tabla se ordena por observados y los empates por etiqueta, nunca por el índice: ordenar por él convertiría una proporción descriptiva en un ranking de lo bueno que es algo, que es exactamente lo que la §17 prohíbe (regla 3).
7. **La página se indexa solo si la corrida trae población**, y entra en el sitemap con la fecha de esa corrida. Sin corrida no hay contenido, y una URL sin contenido es thin content ([ADR 0029](0029-que-se-indexa-y-que-no.md)).
8. **La portada gana el enlace que le faltaba** y deja de ser el único sitio donde vive el reparto. Sus ocho filas se quedan: es el resumen, no la página.
9. **No se añade ni una consulta.** `readRunPopulation` es la lectura que ya piden las páginas de spec y que la caché de proceso recuerda hasta la corrida siguiente ([ADR 0031](0031-presupuesto-de-rendimiento-y-observabilidad.md)). La página nueva no escribe nada: con la cuota de Supabase por encima del límite, eso no es un detalle.

## Por qué

**Porque una página con cuatro de cinco señales es una página, y una issue esperando a la quinta es una issue parada.** El [ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md) acaba de hacer esta misma separación con [#27](https://github.com/Atorey/wow-pvp-intelligence/issues/27): entregar lo que los datos sostienen y sacar lo que no a su propio sitio con su condición de desbloqueo escrita. Lo contrario —esperar a que la ladder madure para publicar nada— deja el reparto de las cuarenta specs sin página durante media temporada por culpa de una columna.

**Porque el tramo mediano es la forma honesta de meter una distribución en una fila.** La alternativa era una barra apilada por tramo, que con diez tramos y cuarenta filas no se lee, o un rating mediano, que no se puede deducir de las medianas de cada tramo. El tramo mediano sí sale de la población acumulada y dice lo que se quiere saber: dónde está la mitad de la gente que juega esa spec.

**Porque publicar «personajes activos» bajo la etiqueta «actividad» sería renombrar una columna que ya está en pantalla.** El número existe y es correcto; lo que no es correcto es presentarlo como la señal de la §17, que habla de partidas jugadas. Un producto que vende trazabilidad no puede permitirse que dos cosas distintas compartan nombre porque una de ellas estaba a mano.

**Porque el índice es la cifra más fácil de leer mal, y ordenar por ella la empeoraría.** Un ×1,9 dice que la spec pesa casi el doble arriba que en el conjunto; no dice que sea mejor. Una tabla ordenada por ese número es una tier list con otro nombre, y la §17 empieza prohibiendo exactamente eso.

## Consecuencias

- **La portada y `/meta` comparten cálculo y no se pueden separar.** Las dos llaman a `representationFor()`, que solo se diferencia en el recorte. Un cambio en cómo se reparte la modalidad cambia las dos a la vez, que es lo que se quiere.
- **La página de spec cambia de mediana sin cambiar de cifra.** `medianSegment()` pasa a delegar en core; su test sigue midiendo lo mismo y el valor que sale es el mismo, porque el algoritmo lo era.
- **Las dos ausencias tienen issue y condición de desbloqueo.** [#126](https://github.com/Atorey/wow-pvp-intelligence/issues/126) para el anti-FOTM, que espera a n≥100 en el tramo alto y lo vigila `npm run pipeline -- coverage`; [#127](https://github.com/Atorey/wow-pvp-intelligence/issues/127) para el volumen de partidas, que necesita agregación nueva. El día que lleguen, la página tiene sitio para ellas y la nota que las declara desaparece.
- **La comparabilidad entre specs caducará sola.** Cuando el tope de 5.000 del leaderboard empiece a apretar, `representation` quedará sesgada a la baja justo en las specs más jugadas y habrá que declararlo en la tabla ([#128](https://github.com/Atorey/wow-pvp-intelligence/issues/128)). Hoy no aprieta: la spec más poblada tiene 3.514 personajes.
- **Una modalidad nueva abre su `/meta` sola.** La ruta cuelga de `BRACKET_SLUGS`, así que el día que entre BG Blitz no hay página que escribir, hay un miembro que añadir al catálogo.
