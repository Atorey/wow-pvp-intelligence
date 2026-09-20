# ADR 0036 — El personaje conocido sin rating: dos estados, una repregunta por `POST` y un TTL que sale de la bitácora

**Fecha**: 20 de septiembre de 2026 · **Estado**: aceptada (issue [#119](https://github.com/Atorey/wow-pvp-intelligence/issues/119)) · **Añade un segundo punto de escritura al reparto del [ADR 0024](0024-busqueda-de-personaje-en-la-web.md)**, que no cambia · **Revisa cómo se mide el TTL de §28 del [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md)** siguiendo el precedente de lectura de la bitácora del [ADR 0030](0030-limite-por-ip-y-cache-de-negativos.md)

## Contexto

Hay una respuesta de Blizzard que no deja ninguna observación: la del personaje que existe y no tiene rating en ningún Solo Shuffle. `rating` es `not null`, así que sin rating no hay snapshot que insertar — correctamente: eso es rotación, un dato más, no un error. Lo que queda es un personaje en `characters` con cero filas en `character_snapshots`, y de esa combinación la web no sabía salir.

Medido sobre `nyurka` · `dun-modr` · eu, que es el caso que abrió la issue:

```
characters:           first_seen_at 2026-08-19
character_snapshots:  (ninguna fila)
character_lookups:    2026-08-19 · outcome = 'no-brackets'
```

Los tres eslabones se encadenaban así:

- **El perfil afirmaba algo falso.** Sin temporada observada se servía la pantalla de personaje desconocido, cuyo copy dice «nadie lo ha consultado aquí». De Nyurka consta una búsqueda con su fila en la bitácora; lo que no consta es rating. Dos estados distintos con el mismo texto, y el segundo mintiendo sobre lo que tenemos.
- **La acción de esa pantalla no escribía.** Era un `<Link>` a `/search?realm=…&name=…`, o sea un `GET`, y `/search` por diseño no le pregunta a Blizzard ([ADR 0024](0024-busqueda-de-personaje-en-la-web.md), decisión 2). Además iba sin `status`, así que la página la interpretaba como `ambiguous`, releía la población, encontraba al personaje y titulaba «varios personajes casan con ese nombre» sobre un único candidato que enlazaba de vuelta al mismo perfil vacío.
- **Volver a buscarlo no podía arreglarlo nunca.** `resolveSearch()` resuelve contra la población antes de tocar la API: una coincidencia exacta es un `found` y una redirección. Para quien ya está en `characters`, la rama que llama a `lookupCharacter()` es inalcanzable — hoy y siempre. No lo bloqueaba el TTL, que con `last_profile_at` nulo habría repreguntado; era que nadie llegaba a invocarlo.

La pieza que resuelve esto ya existía: `refreshPlayer` / `refreshCharacter` es un `POST` que vuelve a preguntar. Solo se pintaba en el perfil con datos, que es justo la pantalla donde no hace falta.

Y hay un cuarto detalle que no se ve hasta que el botón existe: **el TTL de §28 no puede caducar lo que no deja snapshot**. La frescura se medía sobre `max(captured_at)` de los snapshots de perfil, así que un personaje sin rating está eternamente caducado y cada pulsación vuelve a costar dos peticiones (perfil + pvp-summary) a la cuota que se comparte con el pipeline. Con el techo por IP del [ADR 0030](0030-limite-por-ip-y-cache-de-negativos.md) —60 envíos por hora— el suelo del gasto son 120 peticiones por hora y conexión sobre un personaje del que ya sabemos la respuesta.

## Decisión

1. **La ausencia de perfil son dos estados y no uno.** «No está en la población» es el personaje que no está en `characters`; «no le consta rating» es el que está y no tiene ni una observación. Cada uno con su copy, y el segundo **no dice que nadie lo haya buscado**.

2. **El segundo estado va fechado.** Se escribe cuándo fue la última vez que se le preguntó a Blizzard, leído de `character_lookups`. Sin fila que lo respalde no se escribe la fecha: la identidad pudo entrar por el leaderboard, que no pasa por la bitácora.

3. **La acción de esa pantalla es un `<form action={…}>`, no un enlace.** Es la misma Server Action que el botón «Actualizar» del perfil. Con esto la web tiene **dos** caminos que escriben y llaman a Blizzard —el envío del buscador y esta acción, que ya era uno—, y ninguno más.

4. **`/search` sin `status` en la URL no es `ambiguous`.** Es un estado propio: nadie ha resuelto nada todavía. Y el buscador que ofrece esa página llega con el reino y el nombre ya escritos, en todos sus estados.

5. **La frescura del TTL se mide también sobre la bitácora**, con las filas `'ok'` y `'no-brackets'`: las dos son Blizzard describiendo a ese personaje. No cuentan los aciertos de caché —`'cached'` no es haber preguntado— ni los `'not-found'`, que sobre alguien que ya está en la población son un borrado, un rename o un transfer.

6. **Nada de esto cuelga de un `GET`.** Las dos pantallas leen población al renderizarse, que es gratis, y la llamada a Blizzard sigue viviendo solo detrás de un `POST`.

## Por qué

**Porque el estado que no se distingue acaba servido con una mentira.** La regla que rige el copy de este producto es que una ausencia se declara y se explica, nunca se disimula (§2.5 del [brief](../design/brief.md)). «Nadie lo ha consultado aquí» sobre un personaje del que hay una fila de consulta es peor que un hueco: es una afirmación comprobablemente falsa sobre nuestros propios datos, y quien la lee es precisamente el dueño del personaje, que sabe que acaba de buscarlo. El copy nombra el **Solo Shuffle** y no «PvP» por lo mismo: de sus 2v2 o sus RBG no consta nada, ni a favor ni en contra, porque el MVP no los modela (§25 del plan).

**Porque un enlace no puede repreguntar, y no por un descuido que se arregle con otra URL.** `/search` resuelve contra la población antes de tocar la API a propósito, y esa decisión es la que evita gastar una llamada por cada visitante que busca a alguien que ya tenemos. Para el personaje que está en `characters` no hay ninguna URL del buscador que llegue a Blizzard: la única forma de repreguntar por él es la acción que escribe. Que sea un `POST` es lo que la hace posible **y** lo que la hace segura: es una decisión de quien pulsa, no algo que dispare una precarga del navegador.

**Porque un TTL que no puede caducar no es una caché, es un contador de gasto.** §28 pide caché corta para que consultar cinco veces al mismo personaje no cueste cinco veces la cuota, y medida sobre snapshots esa caché tiene un agujero con la forma exacta del personaje que esta pantalla sirve. Lo que deja la respuesta «no tiene rating» es su fila en la bitácora, así que es ahí donde hay que mirar. No es la primera vez: el [ADR 0030](0030-limite-por-ip-y-cache-de-negativos.md) convirtió la misma tabla en la caché de negativos por el mismo motivo y con el mismo índice, sin migración y sin tabla nueva. Lo que ambas comparten es la disciplina de no contar los aciertos de caché: una caché que se autoalimenta mantiene su ventana abierta para siempre con una visita por minuto.

**Porque el `not-found` de un personaje que ya tenemos es justo el caso en que reintentar cambia la respuesta.** Dejarlo fuera del TTL cuesta una petición por pulsación, acotada por el techo por IP, y compra que un transfer o un rename se vean en cuanto terminen. Al revés —congelarlo media hora— se ahorra una ficha y se le dice a alguien que su personaje no existe durante treinta minutos más de lo necesario.

**Porque `ambiguous` por defecto se inventaba el resultado de una búsqueda que no se había hecho.** Una dirección con reino y nombre y sin `status` es una consulta escrita a mano o un enlace viejo; nadie ha resuelto nada. Titular «varios personajes casan con ese nombre» sobre lo que la población devuelva convierte un candidato único en una ambigüedad y una lista vacía en un silencio raro. El estado propio dice lo único cierto: que todavía no se ha preguntado, y que el buscador de abajo es lo que pregunta.

**Porque un buscador que sale en blanco es la misma vuelta a empezar que la pantalla intentaba evitar.** El buscador vuelve a salir en `/search` para no obligar a teclear otra vez; sin los campos rellenos el ahorro era medio, y el campo del reino es exactamente el que más cuesta escribir bien.

## Consecuencias

- **`packages/data` gana `readCharacterIdentity()`**, la primera lectura del paquete que contesta por un personaje **sin** mirar ninguna observación suya. Es también la primera que consulta `character_lookups`, que hasta hoy solo leía el motor de búsqueda.
- **La bitácora pasa a sostener el TTL.** Nadie la poda hoy, y conviene que siga así: borrar filas viejas de `character_lookups` acortaría en silencio la caché de los personajes sin rating y la de negativos del [ADR 0030](0030-limite-por-ip-y-cache-de-negativos.md). Si algún día hay que podarla, el corte tiene que quedar muy por encima de los dos TTL.
- **La fecha que se enseña y el TTL no miran las mismas filas**, y es deliberado: la fecha cuenta también los `'error'` —se preguntó, aunque la respuesta viniera a medias— y el TTL solo las respuestas que describieron al personaje. Preguntar sin obtener respuesta no puede bloquear el reintento.
- **`RefreshForm` sirve a dos pantallas**, y `spec` y `tab` pasan a ser opcionales: la pantalla sin observaciones no tiene spec que elegir ni pestaña que conservar.
- **El copy de esta pantalla tiene sus propios avisos de «no se pudo preguntar»**: los del perfil remataban con «lo de abajo es la última observación registrada», y aquí abajo no hay ninguna.
- **Un personaje sin rating deja de ser un callejón sin salida permanente**, que era la parte más cara del fallo: el perfil quedaba envenenado y ningún TTL lo curaba, así que el jugador de §12 —el que solo entra al dataset si alguien lo busca— aterrizaba en una pantalla que le decía algo falso y no le ofrecía ninguna salida.
