# ADR 0024 — La búsqueda de personaje: dos campos, el fallback en el envío y nada de eso indexado

**Fecha**: 1 de septiembre de 2026 · **Estado**: aceptada (issue [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19)) · **Añade dos rutas al [ADR 0020](0020-mapa-de-rutas-del-sitio.md)** que su catálogo no tenía · Aplica el [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md) y la decisión 7 del [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md). No cambia ninguna de las dos

## Contexto

§21 pide "autocompletado sobre nuestra base acumulada + fallback directo a la API si no existe localmente", y §23 pone el buscador en el centro de la portada. El motor ya existe: `lookupCharacter()` desde el ADR 0006, y la cuota compartida que lo hace seguro en serverless desde el ADR 0013.

Lo que no estaba decidido es la forma de la pantalla, y tres detalles la condicionan entera:

- **La API de Blizzard no sabe buscar por nombre suelto.** Su endpoint de perfil es `/profile/wow/character/{realm}/{name}`: sin reino no hay a quién preguntar. El autocompletado sí puede prescindir del reino, porque nuestra población ya sabe en cuál está cada uno — pero el autocompletado solo alcanza a quien ya tenemos.
- **El plegado no es inyectivo, y la colisión es masiva**: 1.626 grupos de personajes distintos del mismo reino cuyos nombres solo se diferencian en los acentos (ADR 0017). Buscar "arthaslegend" en Magtheridon puede señalar a cuatro personas.
- **La búsqueda escribe.** Un personaje que se busca y no teníamos entra al dataset con `source = 'search'`. Es la capa 2 de población de §12, la única que llega por debajo del corte de 5.000 del leaderboard, y es la razón de ser de la feature — no un efecto secundario.

## Decisión

1. **Dos campos, reino y nombre.** Un único campo dejaría el fallback sin reino justo en el caso que lo necesita: el personaje que no tenemos. La región es la configurada (`BLIZZARD_REGION`), porque el MVP es de una sola (§25).

2. **El fallback se dispara al enviar, y el envío es un `POST`.** Es una Server Action, nunca un `GET` a una página. Un efecto que gasta cuota y escribe población colgado de un `GET` lo dispara cualquier precarga del navegador, cualquier refresco y cualquier compartición del enlace.

3. **El autocompletado no llama a Blizzard nunca.** `GET /api/search` lee solo población acumulada. Se ejecuta una vez por pulsación de teclado y la cuota es la misma que gasta el pipeline.

4. **El buscador funciona sin JavaScript.** Es un `<form>` de verdad con la acción detrás; las sugerencias son la mejora progresiva, no la feature.

5. **`/search` y `/api/search` entran en el mapa de rutas y ninguna se indexa.** La primera lleva prefijo de idioma como toda página; la segunda no, porque devuelve identidades, que son las mismas en las dos lenguas. Ninguna lleva `hreflang`: los alternates declaran equivalencias entre páginas del catálogo, y estas no están en él.

6. **El resultado de un envío viaja en la URL** (`?status=ambiguous|not-found|unavailable`) y la página que lo enseña **no vuelve a averiguarlo**. Solo `ambiguous` relee, y relee población.

7. **"No existe" y "ahora no puedo mirarlo" son dos respuestas distintas, siempre.** Sin cuota o sin presupuesto de tiempo se responde `unavailable`, nunca `not-found`.

8. **La ambigüedad se enseña, no se resuelve.** Varios candidatos por plegado se listan con su grafía real; no se elige por rating ni por lo reciente.

## Por qué

**Porque un solo campo optimiza el caso que ya funciona y rompe el que justifica la feature.** "Escribe un nombre y ya" es mejor experiencia mientras el personaje esté en nuestra población: el autocompletado descubre el reino. Pero el jugador de 1600 que §12 pone en el centro **no está** en nuestra población —ese es el punto entero de la capa 2— y para él el campo único no tiene ninguna respuesta que dar. Se acepta un campo más de fricción para todos a cambio de que el caso que motiva la búsqueda tenga salida.

**Porque el `GET` con efectos no falla el día que se escribe, falla el día que alguien comparte el enlace.** Es tentador servir la búsqueda como `/search?realm=…&name=…` y resolverla al renderizar: la URL queda enlazable y no hace falta una acción. Lo que ocurre después es que Next precarga esa URL al pasar el ratón por encima de un enlace, que el navegador la revalida al volver atrás, y que un enlace pegado en Discord la dispara una vez por persona que lo abre — cada una con su llamada a Blizzard y su fila en `character_snapshots`. Un histórico append-only que mide cambios no se lleva bien con una ráfaga de observaciones idénticas, y es el mismo motivo por el que existe la caché del ADR 0006. La URL enlazable se conserva igual, pero lo que lleva dentro es el **resultado**, no la orden de averiguarlo.

**Porque el autocompletado tocando la API sería la puerta abierta que #71 todavía no ha cerrado.** Una llamada por pulsación de teclado, sin límite por IP, sobre una cuota compartida con el `refresh-leaderboard`: no hace falta un bot, basta con que alguien mantenga pulsada una tecla. Que la API solo se toque en el envío convierte el gasto en una decisión de quien busca, que es lo máximo que se puede acotar antes de que exista el límite por IP.

**Porque el sitio sin JavaScript no es un guiño a la accesibilidad, es cómo se prueba esto.** No hay vitest ni testing-library en la web, y es deliberado ([README](../../apps/web/README.md)): lo que cubre el renderizado es `npm run web:build`. Un buscador que solo funciona con hidratación no tiene forma de comprobarse en este repo. Uno que es un `<form>` con una acción detrás se ejercita desde el navegador con el script desactivado, en un minuto.

**Porque elegir por el usuario entre cuatro Arthaslegend es exactamente lo que el ADR 0017 prohibió.** Ordenar por rating y quedarse con el primero daría una pantalla más limpia y una respuesta equivocada tres de cada cuatro veces. `resolveByFold()` devuelve una lista y no un slug precisamente para que quien llama no pueda "quedarse con el primero" sin darse cuenta.

**Porque decirle a alguien "no existes" porque no nos dio tiempo a mirarlo es el peor error posible de esta pantalla.** Es el único caso en que la web afirma algo falso sobre un dato que sí existe. `BlizzardResponse` ya distinguía `unavailable` de un 404 desde el ADR 0013; lo que hace esta decisión es obligar a que esa distinción sobreviva hasta el copy. El copy exacto de cuando se toca el techo sigue siendo de [#71](https://github.com/Atorey/wow-pvp-intelligence/issues/71); lo que aquí se fija es que sean dos mensajes y no uno.

## Consecuencias

- **La web pasa a escribir en Postgres.** Hasta hoy solo iba a leer (ADR 0014). El camino es único —el envío del buscador— y lo que escribe es lo que ya escribía el CLI.
- **#71 recibe dos puntos de enganche concretos**, y ninguno más: `GET /api/search` y la Server Action. El resto de la web no toca ni cuota ni escritura.
- **`character_lookups` empieza a llenarse de verdad.** La bitácora del ADR 0006 existía para medir si la acumulación por búsqueda aporta población, y hasta ahora solo la movía un comando manual. La hipótesis de §12 pasa a ser medible.
- **Una búsqueda con un reino mal escrito cuesta una petición de más**, como ya anticipó el ADR 0006: la comprobación previa no encuentra la fila y se llama a Blizzard. `readKnownRealms()` + `resolveByFold()` cubren el caso de los acentos, que es el frecuente; el resto lo decide Blizzard con un 404.
- **La portada deja de ser andamiaje.** Con el buscador dentro, `/` es la primera página del sitio que hace algo.
- **`/search` no entra en el sitemap** cuando lo haya (#26): no es contenido, es la consulta de una persona.
