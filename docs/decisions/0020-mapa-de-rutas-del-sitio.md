# ADR 0020 — El mapa de rutas vive en `packages/core`, con una sola URL por recurso

**Fecha**: 26 de agosto de 2026 · **Estado**: aceptada (issue [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25)) · **Desarrolla el [ADR 0012](0012-producto-bilingue.md)**, que fijó el prefijo de idioma y dejó "lo que le queda por decidir a #25" sin decidir; **aplica los ADR [0016](0016-slug-canonico-de-spec.md) y [0017](0017-forma-canonica-de-personaje.md)**, que ya habían fijado las dos piezas que más pesan en una URL. **Desbloquea [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) y [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)**

## Contexto

La §24 del plan propone un mapa de rutas y el [ADR 0012](0012-producto-bilingue.md) le puso delante el prefijo de idioma. Entre los dos queda cerrada la forma general —`/es/spec/frost-mage/solo-shuffle/2000-2200`, con los slugs sin traducir— y quedan abiertas cuatro cosas que no se pueden resolver leyendo el plan, porque el plan se contradice o no llega:

- **La región del perfil.** La §24 escribe `/player/{region}/{realm}/{name}` y la tabla de la §22 escribe `/player/{realm}/{nombre}`. No es un descuido de redacción: la §25 marca la región de lanzamiento como `[UNKNOWN]` y con una sola región la primera forma parece un tramo de más.
- **El tramo de rating de arriba.** `segmentFor()` devuelve el tramo abierto con `id = "3000-Infinity"` y `formatSegment()` lo escribe `3000+`. Ninguna de las dos formas es escribible en una ruta: la primera es un detalle de implementación de JavaScript y la segunda viaja escapada a `%2B` en cuanto alguien la copia.
- **La modalidad.** La URL dice `solo-shuffle` y la BD guarda `shuffle-mage-frost` en la columna `bracket`. Son la misma cosa dicha en dos sitios y en orden distinto, exactamente el problema que el [ADR 0016](0016-slug-canonico-de-spec.md) resolvió para la spec.
- **Dónde vive el texto.** El andamiaje de [#62](https://github.com/Atorey/wow-pvp-intelligence/issues/62) dejó el copy en una constante dentro de `page.tsx` con un comentario que remitía a esta issue. Con dos lenguas y cinco plantillas de página, eso ya no escala.

Hay además una restricción que llega de fuera y que conviene tener escrita antes de abrir la primera ruta: **una URL indexada no se puede cambiar sin quemar posicionamiento**, y la §39 cuenta la autoridad de dominio como moat. Todo lo que se decida aquí se decide una vez.

## Decisión

1. **El mapa del MVP es el de la §24 del plan, con el prefijo de idioma delante y sin traducir ningún tramo** ([ADR 0012](0012-producto-bilingue.md), decisiones 2 y 3):

   ```
   /{locale}/                                             → portada y búsqueda
   /{locale}/player/{region}/{realm}/{name}               → perfil + Player Gap
   /{locale}/spec/{spec-clase}                            → overview de spec
   /{locale}/spec/{spec-clase}/{modalidad}                → overview por modalidad
   /{locale}/spec/{spec-clase}/{modalidad}/{tramo}        → página de segmento
   /{locale}/methodology                                  → transparencia de cálculo
   ```

2. **La ruta de perfil lleva la región siempre**, también mientras se sirva una sola. Resuelve la contradicción entre la §24 y la §22 a favor de la §24.

3. **La modalidad es un tramo propio con slug propio** (`solo-shuffle`), distinto del bracket de Blizzard. `BRACKET_SLUGS` lo cataloga, `BRACKET_LABELS` dice cómo se escribe en pantalla y **`bracketIdFor()` es el único puente** hacia el `shuffle-mage-frost` que guarda la columna. Hoy el catálogo tiene un solo miembro, porque el MVP tiene una sola modalidad (§25).

4. **El tramo abierto se escribe `3000-plus`.** Ni `3000+` ni `3000` a secas ni `3000-Infinity`.

5. **Solo se abren las rutas del MVP.** `/compare/{a}-vs-{b}`, `/meta/{bracket}`, `/rankings/{bracket}`, `/trends` y `/privacy` quedan **declaradas aquí y sin código**: la §25 las sitúa en MVP+ o más allá, y una ruta sin datos es una página vacía que se puede indexar.

6. **El mapa vive en `packages/core` y no sabe de idiomas.** Construye y parsea rutas sin prefijo; quien las publica les antepone el locale con `localizedPathname()`. Es la misma razón por la que el slug de spec vive ahí ([ADR 0016](0016-slug-canonico-de-spec.md)): la web las pinta y el pipeline las generará para el sitemap y el enlazado interno de [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26).

7. **Una URL por recurso, y las variantes redirigen con 308.** Lo que solo se diferencia en la caja (`/spec/Frost-Mage`) o escribe el tramo abierto con `+` redirige permanentemente a la forma canónica. Lo que **no está en el catálogo** —una spec inexistente, una modalidad que no publicamos, una región que no servimos— es **404, no una redirección adivinada**.

8. **Los acentos no se canonicalizan nunca.** La §22 pide "canonicalizar variantes de capitalización/tildes" y aquí se cumple solo la mitad izquierda: `arthaslegend` y `árthaslegend` son dos páginas porque son dos personas ([ADR 0017](0017-forma-canonica-de-personaje.md)). La forma canónica de la URL es la acentuada, y el porcentaje-escape es su forma de viajar, no otra URL.

9. **Solo existen los segmentos que la escala genera.** `parseSegmentSlug()` resuelve contra `allSegments()`, así que `2010-2190` es un 404 y no una página de segmento con otros límites.

10. **El copy vive en `apps/web/src/i18n/copy`, en diccionarios tipados y sin librería de i18n.** El inglés define la forma (`Copy = typeof en`), así que una clave que falte o que sobre en español rompe el `typecheck`. El copy no baja a `packages/core` ([ADR 0012](0012-producto-bilingue.md), decisión 7).

11. **La cabecera y el pie se renderizan desde el layout**, y con ellos la línea de atribución de la [§4.3 del brief](../design/brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua) y el conmutador de idioma, que el [ADR 0012](0012-producto-bilingue.md) exige visible y persistente.

12. **El 404 deduce el idioma de la ruta pedida, no de la petición.** Es la única página sin tramos propios, y leerlo con `headers()` marca como dinámica toda la rama que cuelga del layout: la portada y la metodología dejan de generarse en build por culpa de la página de error.

## Por qué

**Porque la región es identidad, no configuración.** La unicidad de un personaje en la BD es `(region, realm_slug, name_slug)` desde la primera migración, y hay reinos con el mismo nombre en regiones distintas. Servir hoy `/player/sanguino/ánatorey` obligaría mañana a migrar todas las URL de perfil ya indexadas, que es precisamente lo que el [ADR 0012](0012-producto-bilingue.md) evitó al descartar el inglés sin prefijo. El tramo de más cuesta doce caracteres; quitarlo y volver a ponerlo cuesta el posicionamiento acumulado.

**Porque `3000+` parece más legible hasta que sale de la barra de direcciones.** El `+` sobrevive en el navegador y no sobrevive al copiado, al `curl`, ni a un `<link rel="canonical">` que alguien genere sin escapar. `3000-plus` es ASCII, mantiene la simetría con `2800-3000` —el tramo de arriba se lee como los demás— y dice lo que significa. La alternativa de nombrarlo solo por su suelo (`3000`) rompe esa simetría y deja al lector adivinando si es un tramo o un rating.

**Porque el catálogo de modalidades tiene un solo miembro y aun así merece existir.** La tentación es escribir `"solo-shuffle"` literal en cinco sitios mientras solo haya uno. El día que entre BG Blitz, esos cinco literales son cinco sitios donde mirar, y el puente hacia el bracket de Blizzard —que no es mecánico, porque aplasta los slugs compuestos— se habrá reconstruido a mano en alguno. Es el mismo argumento del [ADR 0016](0016-slug-canonico-de-spec.md) aplicado un nivel más arriba.

**Porque "esto no existe" y "esto está mal escrito" no son la misma respuesta.** Redirigir lo que no reconocemos es adivinar, y adivinar mal en una URL indexable crea una página que dice una cosa en una dirección que promete otra. Contestar 404 a una spec que no está en el catálogo es exacto: no la publicamos. Redirigir la caja sí es correcto porque no hay nada que adivinar — la forma canónica es única y conocida.

**Porque una librería de i18n resolvería un problema que este producto no tiene.** Dos lenguas fijas, sin plurales dependientes de cantidad, sin fechas relativas, y con las rutas ya resueltas por el prefijo. Lo que una librería aporta ahí es un `Provider` de cliente y un formato de fichero que TypeScript no revisa; lo que hace falta —que las dos lenguas tengan exactamente las mismas claves— lo da el tipo, gratis y en tiempo de `typecheck`. La §29 del plan avisa contra la sobrearquitectura y este es el caso literal.

**Porque el 404 no puede costar el renderizado estático del resto del sitio.** Medido en el build: con `headers()` en `not-found.tsx`, `/en`, `/es`, `/en/methodology` y `/es/methodology` pasan de prerenderizadas a servidas bajo demanda. Son las cuatro páginas del MVP que no dependen de ningún dato, y son justo las que deberían costar cero.

## Consecuencias

- **[#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) recibe la ruta de perfil resuelta y validada.** `resolvePlayerRoute()` le entrega `(region, realmSlug, nameSlug)` ya canónicos o le dice que redirija; lo que queda es leer de `@wowpvp/data` y pintar. El **nombre para mostrar** sale del perfil, no de la URL: el `nameSlug` es minúsculas por definición y el placeholder lo enseña tal cual a propósito.
- **[#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) hereda el mapa y dos reglas que le acotan el trabajo**: solo existen las URL que el catálogo genera (nada de combinaciones cruzadas que inventar), y las variantes de escritura ya están consolidadas con 308 antes de que llegue a decidir qué se indexa. El sitemap se construye recorriendo `ALL_SPECS × BRACKET_SLUGS × allSegments()`, no una lista escrita a mano.
- **[#20](https://github.com/Atorey/wow-pvp-intelligence/issues/20) tiene su ruta abierta y estática**, en las dos lenguas, esperando contenido.
- **[#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19) sabe a dónde llevar.** El resultado de una búsqueda es un `playerPath()`, y la desambiguación por plegado ([ADR 0017](0017-forma-canonica-de-personaje.md)) devuelve varios de ellos, no uno.
- **El pipeline pierde su propia lista de regiones**: `getRegion()` valida contra `REGIONS` de `packages/core`. Ingerir una región que el sitio no sabe publicar dejaría datos sin página donde colgarlos.
- **Aparece un coste recurrente pequeño**: cada string nuevo se escribe en dos ficheros, y el `typecheck` no deja olvidarse del segundo. Es el precio ya aceptado en el [ADR 0012](0012-producto-bilingue.md), ahora con quien lo cobra.
- **Queda pendiente `/privacy`**, que el pie del brief enumera y el plan no. No se enlaza mientras no exista: un enlace a un 404 en todas las páginas es peor que la ausencia del enlace.
- **Las páginas existen y no enseñan nada todavía.** Es deliberado: rellenarlas con cifras de ejemplo mientras se maqueta sería inventar el dato que este producto vende. Lo que muestran es lo que se deduce de la propia URL.
