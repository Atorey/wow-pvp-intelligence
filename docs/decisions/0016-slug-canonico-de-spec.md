# ADR 0016 — Un solo slug de spec, en orden spec-clase, y lo decide la URL

**Fecha**: 24 de agosto de 2026 · **Estado**: aceptada (issue [#63](https://github.com/Atorey/wow-pvp-intelligence/issues/63)) · **No sustituye a ningún ADR**; confirma y precisa el punto 3 del [ADR 0012](0012-producto-bilingue.md), que ya escribía `frost-mage` sin decir que fuera una decisión. **Desbloquea [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25)** y corrige la plantilla de §24 del plan

## Contexto

Había dos formas de nombrar la misma spec y ninguna estaba decidida.

El pipeline usa **`mage-frost`**: `specKey()` en `packages/core` la construía como `classSlug-specSlug`, y de ahí salía el flag `--specs mage-frost` de `sample-profiles`. El plan escribe **`frost-mage`** en las tres filas de §22 (`/spec/frost-mage/solo-shuffle/2000-2200`) y el ADR 0012 la repitió al fijar el prefijo de locale. Y el propio plan se contradice consigo mismo: §24 declara la plantilla `/spec/{class}-{spec}`, que es la forma contraria a sus propios ejemplos.

Ninguna de las dos formas se puede parsear partiendo el string por guiones, que es el mismo problema que ya resuelve `parseShuffleBracket`: `frost-death-knight` tiene tres tramos, y `beast-mastery-hunter` daría spec "beast" y clase "mastery-hunter". La resolución es siempre contra el catálogo.

Lo que decide el orden no es el gusto sino **dónde se paga el error**. El slug de URL se indexa y luego no se cambia sin migrar URLs ya posicionadas — §39 del plan cuenta la autoridad de dominio como moat, y el ADR 0012 ya señaló las migraciones de URL como lo que la quema. La clave del pipeline, en cambio, **no está persistida en ninguna parte**: el schema guarda `bracket`, `class_slug` y `spec_slug` en columnas separadas ([0001_init.sql](../../db/migrations/0001_init.sql)), así que `specKey()` solo vivía en memoria y en un flag de CLI.

Hay además una tercera forma que no compite con estas dos: **`shuffle-mage-frost`**, el bracket tal como lo exige la API de Blizzard, con los slugs compuestos aplastados (`deathknight`). Esa no se elige, se acata.

## Decisión

1. **El slug canónico de una spec va en orden spec-clase: `frost-mage`.** Es el `label` del catálogo en minúsculas y con guiones, sin excepciones: `frost-death-knight`, `beast-mastery-hunter`, `restoration-druid`.

2. **Es una sola forma para todo el proyecto.** La misma en las URL del sitio, en la agrupación en memoria y en la entrada de usuario del pipeline (`--specs frost-mage`). `specKey()` desaparece; no hay clave interna distinta del slug público.

3. **Vive en `packages/core`, junto al catálogo**, con su función y su inversa: `specSlug()`, `parseSpecSlug()` y `requireSpecSlug()` — esta última falla ruidosamente, con el mismo criterio que `requireSpec()`, para entrada de usuario y configuración estática.

4. **La inversa se resuelve contra el catálogo, nunca partiendo por guiones.** Igual que `parseShuffleBracket`, y por la misma razón.

5. **El bracket de Blizzard no es un slug de URL.** `shuffleBracketId()` sigue siendo la forma que pide la API (`shuffle-mage-frost`) y no se publica en ninguna ruta. Las dos formas conviven en orden inverso a propósito, y hay un test que fija que `parseSpecSlug("mage-frost")` devuelve `undefined`: es la decisión, no un descuido.

6. **No se acepta la forma antigua ni como alias ni como redirección.** No hay nada publicado que redirigir, y admitir las dos formas crearía dos URL para la misma página — justo el problema de canonicalización que [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) tendría que limpiar después. En el CLI, un `--specs mage-frost` rompe al arrancar en vez de muestrear menos specs en silencio.

7. **La base de datos no guarda el slug.** Sigue con `class_slug` y `spec_slug` por separado, y el slug se compone al leer. Es lo que mantiene el orden reversible mientras no haya nada indexado, y lo que evita una migración el día que se revise.

8. **Aquí no se deciden los otros dos tramos de la ruta.** El slug de bracket (`solo-shuffle`) es de [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25); el de segmento (`2000-2200`) ya lo fija `RatingSegment.id`.

## Por qué

**Porque el coste de equivocarse es asimétrico.** Un slug público mal elegido se paga durante años en redirecciones y posicionamiento perdido; una clave interna que no está en la base de datos se cambia en una tarde — de hecho es exactamente lo que ha costado esta decisión. Si el criterio hubiera sido "lo que ya está escrito", habría ganado `mage-frost` sin discusión; no es un criterio, es inercia.

**Porque el slug es el `label` y eso lo hace comprobable.** `Frost Mage` → `frost-mage` es una regla que se verifica a ojo y, sobre todo, en un test que recorre las 40 specs. Con el orden contrario hay que saber dónde cae la frontera clase/spec, que es justo la ambigüedad que obliga a resolver contra el catálogo.

**Porque es el orden en que se lee y se busca.** El long-tail de §22 es "frost mage solo shuffle build", y el ADR 0012 ya argumentó que el hispanohablante también teclea "frost mage". El peso del orden de palabras en la URL es modesto y no sostendría la decisión por sí solo; lo que sí pesa es que la URL la lee una persona antes de hacer clic, y `mage-frost` se lee como una clave de base de datos.

**Porque dos verdades sobre lo mismo es lo que motivó el issue.** Mantener clave interna y slug público separados habría dejado una tabla de equivalencias que alguien tendría que consultar cada vez que un dato cruza de un lado a otro, y el día que el pipeline genere enlaces internos ([#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)) habría que decidirlo otra vez.

## Consecuencias

- **[#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25) recibe cerrado el tramo `/spec/{slug}`** y solo le queda decidir el del bracket. Con el prefijo de locale del ADR 0012, la ruta larga queda `/{en|es}/spec/frost-mage/{bracket}/{rating-range}`.
- **El CLI cambia de vocabulario**: `--specs frost-mage,fury-warrior`. Cualquier comando guardado con la forma antigua falla al arrancar con un mensaje que explica el orden; no muestrea de menos.
- **Ordenar por slug ya no agrupa por clase.** Las tres specs de mago quedan dispersas alfabéticamente, así que cualquier listado —sitemap, índice de specs, ayuda del CLI— ordena por `(classSlug, specSlug)` y no por el slug. Es el coste aceptado de la decisión.
- **Una spec nueva de un parche entra con su `label` mandando.** Si el `label` del catálogo no es coherente con sus slugs, el test que compara los 40 slugs contra el `label` rompe antes de que la incoherencia llegue a una URL. Se suma al aviso que ya da `unknownShuffleBrackets()` cuando Blizzard publica un bracket que el catálogo no mapea.
- **§24 del plan se corrige** para que su plantilla diga lo mismo que sus ejemplos de §22. El plan deja de tener dos formas.
- **Mientras no haya nada indexado, esta decisión sigue siendo barata de revisar.** En cuanto la web publique, deja de serlo: revisarla pasaría a costar una migración de URL, que es precisamente lo que la decisión 7 mantiene fuera de la base de datos.
