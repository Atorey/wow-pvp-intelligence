# ADR 0028 — La medición del Player Gap es de primera parte, y por eso no hay banner

**Fecha**: 6 de septiembre de 2026 · **Estado**: aceptada (issue [#69](https://github.com/Atorey/wow-pvp-intelligence/issues/69)) · **Deroga la fila "Analytics de producto" de §29 del plan** · **Revisa la decisión 5 del [ADR 0020](0020-mapa-de-rutas-del-sitio.md)**, que dejaba `/privacy` declarada y sin código · **Cumple la decisión 9 del [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md)**

## Contexto

La North Star de §35 no es un pageview:

> **Player Gap views con resultado de confianza "High" o "Medium" por usuario único activo semanal.**

Y su gemela de salud del dato —el _"% de Player Gap views con confianza Low"_— sale del mismo sitio. Las dos son cocientes sobre el mismo suceso: **que la caja se enseñó, y cómo acabó**. Eso no se deduce de la URL ni del tráfico de una página; solo lo sabe el componente que decidió qué pintar. [#31](https://github.com/Atorey/wow-pvp-intelligence/issues/31) es de Phase 3, pero si la caja se termina sin instrumentar, la métrica no se pierde durante una fase: se pierde hacia atrás y para siempre.

La §29 del plan escribió "PostHog o Plausible" en la fila de analítica. Esa fila se decidió antes de que existieran dos cosas que ahora la contradicen.

**La primera es la ToU de Blizzard.** La 2.i prohíbe transferir Data a terceros y la 2.h lo repite con un paréntesis que aquí es el que manda —_"including anonymous, aggregate or derived data"_—. El nivel de confianza de un Player Gap **es dato derivado**: sale de agregar observaciones que vienen de la API. PostHog no es una red publicitaria ni un data broker, así que la 2.h no lo alcanza de lleno; la 2.i, que es más ancha, sí obliga a defender por escrito que un servicio de analítica en el que depositamos ese dato no es "a third party" al que se le "transfiere". Es una lectura interpretativa que habría que firmar, no un trámite.

**La segunda es lo que el sitio ya es.** Hoy no pone ni una cookie: lo único que toca el navegador es `localStorage` —el tema y las búsquedas recientes—, y las tres tipografías se autoalojan con el motivo escrito en el layout, _"no hay petición a un tercero desde el navegador del jugador"_. Un script de PostHog sería el primer tercero y la primera cookie, y con ella el primer banner.

Y el banner no sale gratis en la propia métrica: si la North Star solo cuenta a quien acepta, mide la mitad que aceptó y no el uso del producto, que es lo que la §35 quería medir.

> **Esto no es asesoramiento legal.** Es la lectura de las obligaciones aplicables, fechada, para que quien venga detrás pueda contrastarla en vez de creerla.

## Decisión

1. **El evento lo emite la propia caja Player Gap y aterriza en nuestra Postgres.** Una fila por render en `player_gap_views` ([migración 0014](../../db/migrations/0014_medicion_de_player_gap.sql)), escrita desde `/api/gap-view`. **Ningún tercero de analítica**, ni script externo, ni servicio alojado fuera.

2. **No hay banner de consentimiento, porque no hay nada que consentir.** Sin cookies, sin terceros, sin publicidad, sin perfilado y sin seguimiento entre sitios, lo que queda es medición de audiencia de primera parte para estadística agregada, que es el caso que las guías de la AEPD y de la CNIL dejan fuera del consentimiento. La base legal del tratamiento es el interés legítimo, y está escrita en la propia política.

3. **El "usuario único" es un identificador anónimo de primera parte en `localStorage`, con caducidad de 90 días.** No es una cookie —no viaja en ninguna cabecera— y no se cruza con nada. Se eligió frente a un hash rotatorio de IP porque el hash diario no sabe contar una **semana**: la misma persona sería siete personas, y la métrica dice "único semanal".

4. **Se emite en los cuatro desenlaces**, `insufficient` y `top-segment` incluidos. Son el denominador de la North Star, y la métrica de salud del dato es literalmente la proporción del primero. Instrumentar solo los éxitos haría que las dos cifras subieran solas.

5. **No se guarda nada de quien mira, ni el personaje que mira.** Ni IP, ni user-agent, ni la ruta. La fila lleva el desenlace, la spec, la modalidad, el segmento objetivo, el idioma y el identificador. Se guardan spec y segmento porque la §35 dice que el % de confianza Low _"alimenta decisión de acumulación por búsqueda"_, y esa decisión necesita saber **dónde** sube.

6. **La política de privacidad es una sola página, `/privacy`, en las dos lenguas**, y cubre a la vez al visitante y al personaje. Son dos tratamientos distintos y una sola obligación: la 2.p exige publicarla y que sea consistente con la de Blizzard, la 2.k exige declarar los datos _"as is"_, y la 2.s enlaza el ciclo de 30 días del [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) con el derecho de supresión. Partirla en dos páginas repartiría una obligación entre dos sitios.

7. **El texto legal no vive en el diccionario de copy**, sino en `apps/web/src/i18n/legal`, con la misma mecánica —dos diccionarios tipados, el inglés define la forma— y su propio test. El guardián causal de `copy.test.ts` vigila el **copy de datos**, que es donde la regla 3 del proyecto tiene sentido; un texto legal no cuelga de ninguna cifra, y meterlo ahí obligaría a eximir una sección entera, que es exactamente lo que aquel test prohíbe. La etiqueta del enlace del pie sí es copy y se queda donde estaba.

8. **La dirección de contacto sale del entorno**, en `PRIVACY_CONTACT`. Es la única línea del documento que no está escrita, para que ponerla sea rellenar una variable y no editar un texto legal en dos idiomas. **En producción no es opcional**: sin ella, `/privacy` lanza en vez de publicarse incompleta.

9. **El identificador caduca y la retención se declara.** 90 días cubren la ventana más larga que pregunta §35 —retención D30— con margen. Lo que la política promete es lo que el código hace, no una intención.

## Por qué

**Porque la cláusula que más caro sale no es la que prohíbe anuncios, es la que define Data.** La tentación con la fila de §29 es leer la 2.h, ver "ad network, data broker" y concluir que PostHog no es ninguna de las dos. Es cierto y no es la pregunta. El paréntesis —_"including anonymous, aggregate or derived data"_— dice que la confianza de un Player Gap viaja con las mismas restricciones que el rating del que salió, y la 2.i prohíbe transferir eso a **cualquier** tercero sin adjetivos. Guardarlo en nuestra base no obliga a interpretar nada; mandarlo fuera obliga a interpretar una cláusula ancha a nuestro favor, y esa interpretación habría que sostenerla el día que Blizzard pregunte.

**Porque el banner cobra dos veces y la segunda no se ve.** Cuesta la pieza de interfaz, sí. Pero sobre todo cuesta la métrica: una North Star que solo cuenta a quien acepta no mide el uso del producto, mide la tasa de aceptación multiplicada por el uso. Y ese sesgo no es constante —quien rechaza no es una muestra aleatoria de quien visita—, así que ni siquiera se puede corregir con un factor. Se descubriría comparando la métrica con la realidad, que es justo lo que no hay forma de hacer.

**Porque un endpoint propio cuesta menos que la conversación de si se puede usar el ajeno.** Es una tabla, un `insert` y un validador. Lo que compra es que no haya que releer una ToU cada vez que alguien proponga añadir una propiedad al evento, y que la política de privacidad pueda decir "no hay terceros" sin asteriscos. El único asterisco que queda —los iconos servidos desde el CDN de Blizzard ([ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md), decisión 7)— está nombrado en la propia página, porque callarlo convertiría una frase cierta en una falsa.

**Porque contar personas y contar visitas son preguntas distintas, y la §35 eligió la primera.** Un hash rotatorio de IP es el mecanismo más limpio que existe —no guarda nada en el equipo de nadie— y no sirve aquí: con sal diaria, quien vuelve el martes es otro. Redefinir la métrica a "unique diario" para poder usarlo sería cambiar la definición del producto para encajar en la herramienta. Un identificador de primera parte, anónimo y caduco, responde la pregunta que se hizo, y lo que cuesta —estar dentro del art. 5.3 y necesitar la exención— se paga escribiendo la lectura, no fingiendo que no aplica.

## Consecuencias

- **[#31](https://github.com/Atorey/wow-pvp-intelligence/issues/31) hereda datos, no una herramienta.** La North Star y la métrica de salud son dos consultas SQL sobre `player_gap_views`; el resto de §35 —WAU/MAU, retención D1/D7/D30, sessions per user, conversión de búsqueda a Player Gap— **no** sale de esta tabla y sigue siendo suya, con la decisión de si se instrumenta igual o no se instrumenta. Lo que ya no puede hacer es traer un tercero sin un ADR que revise la decisión 1.
- **§29 del plan pierde su fila de analítica y §33 su tarea de la semana 2.** "PostHog o Plausible" y "instrumentar analítica de producto (PostHog)" quedan derogadas. Reabrirlo es un ADR nuevo, no un `npm install`.
- **El ADR 0020 abre una ruta.** `/privacy` deja de estar declarada sin código y entra en el pie de todas las páginas, encima de la línea de atribución ([§4.3 del brief](../design/brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua)). Sigue fuera del sitemap y del catálogo indexable hasta que [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) decida qué se indexa.
- **Aparece el segundo componente de cliente del sitio.** `GapViewEvent` no pinta nada y aun así tiene que serlo, porque el identificador vive en el navegador y la caja se renderiza en el servidor. Es una excepción con motivo, no el principio de una web de cliente.
- **`/api/gap-view` es el primer endpoint abierto que escribe en Postgres.** Valida contra los catálogos que ya existen y descarta lo que no encaje, pero **no tiene límite por IP**: eso sigue siendo de [#71](https://github.com/Atorey/wow-pvp-intelligence/issues/71), que ahora tiene un segundo motivo para existir. Hasta entonces, lo que acota el daño es que una fila inventada tiene que ser válida para contar, y que la tabla no alimenta ninguna decisión automática.
- **La política de privacidad promete un ciclo de 30 días que hoy no ejecuta nadie.** El barrido que revalida a los personajes que no aparecen en el leaderboard, y el borrado del que ya no existe, siguen sin issue desde el [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md). Escribirlo en la política no lo implementa: lo convierte en una promesa pública con fecha, que es un motivo más para abrir esa issue antes de la beta.
- **La retención de `player_gap_views` está declarada y no está barrida.** El identificador caduca en el navegador a los 90 días; las filas no se borran solas. Es el mismo hueco que [#48](https://github.com/Atorey/wow-pvp-intelligence/issues/48) tiene abierto para el resto de las tablas, y se resuelve con él.
- **La lectura legal de la decisión 2 caduca como la del ADR 0015.** Se relee antes de la beta cerrada ([#30](https://github.com/Atorey/wow-pvp-intelligence/issues/30)) y antes del lanzamiento público ([#32](https://github.com/Atorey/wow-pvp-intelligence/issues/32)), y con ella la fecha de `LEGAL_UPDATED_AT`.
