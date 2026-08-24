# ADR 0017 — La forma canónica de un personaje es la de Blizzard, y el plegado solo sirve para buscar

**Fecha**: 24 de agosto de 2026 · **Estado**: aceptada (issue [#70](https://github.com/Atorey/wow-pvp-intelligence/issues/70)) · **No sustituye a ningún ADR**; aplica al nombre y al reino el mismo criterio que el [ADR 0016](0016-slug-canonico-de-spec.md) fijó para las specs, y corrige un comentario de [0001_init.sql](../../db/migrations/0001_init.sql) que describía mal lo que el código hace desde el día 1. **Desbloquea [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19) y [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)**

## Contexto

La §22 del plan pide "canonicalizar variantes de capitalización/tildes" en `/player/{realm}/{nombre}`, y el mismo problema aparece a la vez en tres sitios: la búsqueda de #19 tiene que encontrar al mismo personaje escrito de varias formas, el perfil de #17 necesita una URL única, y #26 no puede indexar N rutas del mismo jugador.

Leída literalmente, esa frase dice "quita las tildes". Antes de escribirla se midió la población acumulada: **126.920 personajes** en EU.

| Medida                                             | Resultado                                                                      |
| -------------------------------------------------- | ------------------------------------------------------------------------------ |
| `name_slug` fuera del ASCII                        | 37.337 (29,4%)                                                                 |
| Siguen fuera del ASCII tras plegar los diacríticos | 20.081                                                                         |
| Grupos del mismo reino que colisionan al plegar    | 1.424 con `NFD` solo; **1.626** con la tabla completa, 3.734 personajes dentro |

En Magtheridon conviven `artháslegend`, `arthaslegend`, `árthaslegend` y `ártháslegend`: cuatro personajes **distintos**. En Ravencrest, `smøkyý`, `smøkyy` y `smøkÿý`. La identidad en base de datos es `unique (region, realm_slug, name_slug)`, así que plegar la identidad no "canonicaliza": funde a cuatro personas en una fila y con ellas sus históricos, que es exactamente lo que el [ADR 0002](0002-modelo-append-only.md) protege y lo único que este producto tiene y la competencia no.

Hay un segundo hecho que desmonta la lectura literal: **los slugs de reino de Blizzard conservan los diacríticos**. En la población están `confrérie-du-thorium`, `aggra-português`, `chants-éternels`, `la-croisade-écarlate`, `festung-der-stürme` y `marécage-de-zangar`, tal cual los publica la API. La regla de Blizzard es minúsculas, apóstrofos y paréntesis fuera, espacios a guion — nunca quitar acentos. Un slug de reino "normalizado" a ASCII no es más limpio: es un 404 en la API y un join vacío contra nuestra propia tabla.

Y un tercero: para 15.171 nombres —todo el cirílico— no existe forma ASCII. No hay una versión "sin acentos" del ruso; hay transliteraciones, varias e incompatibles entre sí.

El código, mientras tanto, ya hacía lo correcto sin haberlo decidido: la ingesta guardaba `name.toLowerCase()` con los acentos intactos y la búsqueda tenía un test que lo fijaba. Lo que faltaba era el nombre de esa decisión, una sola función y la clave con la que buscar.

## Decisión

1. **La forma canónica de un personaje es la de Blizzard**: `name_slug` en minúsculas con los diacríticos intactos, `realm_slug` tal como lo publica la API. Es a la vez la identidad en base de datos, la ruta pública y lo que se le pide a la API. No hay una cuarta forma.

2. **Existe una segunda forma, la plegada, y no es identidad ni es ruta.** `foldSlug()` quita diacríticos y traduce las letras que `NFD` no descompone (`ø`, `æ`, `œ`, `ð`, `þ`, `ß`, `ł`, `đ`, `ħ`, `ŋ`, `ı`). Solo sirve para _buscar_: casa variantes y admite varios resultados.

3. **El plegado no es inyectivo y quien lo use tiene que asumirlo.** `resolveByFold()` devuelve una lista, no un slug. Con 1.626 grupos en colisión, quedarse con el primer resultado es reportar a otra persona. Donde haya una forma exacta, se prueba antes que la plegada.

4. **El cirílico no se translitera.** El plegado sí quita los diacríticos que `NFD` reconoce dentro del cirílico (`ё` → `е`, `й` → `и`, que es lo que espera quien teclea en ruso), pero no convierte alfabetos. Quien busca a `эльторо` lo escribe en ruso.

5. **La URL canónica del perfil lleva el nombre acentuado, percent-encoded.** Las variantes —mayúsculas, acentos distintos— se resuelven por plegado: **301** a la canónica cuando hay un único resultado, página de desambiguación cuando hay varios. Es lo que #26 necesita para no indexar N rutas del mismo jugador, y la única forma que existe siempre.

6. **Todo vive en `packages/core`**, junto al catálogo de specs y por la razón del [ADR 0001](0001-estructura-del-repo-y-stack.md): `nameSlug()`, `realmSlug()`, `foldSlug()`, `resolveByFold()`, `parseCharacterRef()` y `formatCharacterRef()`. El pipeline normaliza al insertar y la web normalizará al buscar; con dos implementaciones, el mismo jugador entra dos veces.

7. **`characters.name_fold` guarda el plegado, indexado y sin restricción de unicidad**, y lo escribe únicamente `upsertCharacters()` a partir de `nameSlug` — no se puede pasar por fuera. Sin columna indexada, resolver una variante sobre 127k filas es un escaneo por búsqueda.

8. **La regla de plegado no se escribe nunca en SQL.** Ni columna generada ni `unaccent`: la extensión de Postgres no conoce `ø`, `æ` ni `ß`, y el backfill (`npm run pipeline -- backfill-name-fold`) usa la misma `foldSlug()` que la búsqueda. Dos escrituras de la misma regla divergirían a la primera letra que se añadiera a la tabla.

9. **`realmSlug()` sobre entrada de usuario es una conjetura, no una fuente de verdad.** Cuando el reino viene de Blizzard se usa tal cual. Lo que decide un reino tecleado a mano es `resolveByFold()` contra los reinos que ya conocemos, no la función a solas: la regla acierta en los 267 reinos observados, pero no hay garantía de que acierte en el 268.

10. **La identidad no cambia y no hay migración de datos.** Comprobado sobre las 126.920 filas: `nameSlug(name_display)` reproduce exactamente el `name_slug` guardado en todas ellas, y `realmSlug(slug) === slug` en los 267 reinos. Lo único que se añade es la columna plegada.

## Por qué

**Porque el coste de equivocarse vuelve a ser asimétrico, como en el ADR 0016, pero en la otra dirección.** Allí lo caro era el slug público y barata la clave interna. Aquí lo irreversible es la identidad: fundir a los cuatro Arthaslegend borra cuatro históricos y no hay forma de deshacerlo, porque el modelo es append-only y nunca volveremos a ver los snapshots que ya se solaparon. Una URL fea se cambia; un histórico fusionado no se reconstruye.

**Porque "quitar tildes" no describe el problema.** Describe el caso español —`á`, `é`— y falla en los tres que la población tiene de verdad: las letras nórdicas que no son una letra con acento, el cirílico que no tiene forma latina, y los personajes que se llaman igual salvo por el acento y son personas distintas. La frase del plan es un titular correcto sobre un caso; la decisión tiene que cubrir el 29,4%.

**Porque la canónica no la elegimos nosotros.** Un nombre sin su acento devuelve 404 en la API de Blizzard, no una respuesta vacía; un slug de reino sin acento no casa con nada de lo que ya tenemos guardado. Elegir otra forma como canónica obligaría a traducir en cada frontera —una vez para la URL, otra para la API, otra para el join—, y cada traducción es un sitio donde perder a alguien.

**Porque separar identidad de búsqueda es lo que permite ser tolerante sin mentir.** Con una sola forma hay que elegir entre encontrar a quien escribe sin acentos y no confundir a personajes distintos. Con dos, la búsqueda es todo lo laxa que haga falta y la identidad todo lo estricta que exige el histórico. La ambigüedad no desaparece —1.626 grupos—, pero se hace visible: se desambigua en pantalla en vez de resolverse a suertes en un `find`.

**Porque el issue lo pedía en `packages/core` por la razón correcta.** El pipeline ya normalizaba al insertar. Si la web de Phase 2 normalizara por su cuenta, la primera diferencia no daría error: daría un personaje duplicado y un histórico partido, descubierto meses después.

## Consecuencias

- **[#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19) recibe cerrada la forma de la clave y el índice**, y hereda una obligación: su autocompletado devuelve una lista, y cuando el plegado casa con varios personajes los enseña todos. No puede quedarse con el de más rating y llamarlo "el resultado".
- **[#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) hereda la regla 5**: canónica acentuada, 301 desde las variantes cuando no hay ambigüedad, desambiguación cuando la hay. Se suma a las tres reglas que ya le dejó el [ADR 0012](0012-producto-bilingue.md).
- **[#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) tendrá URLs percent-encoded** para el 29,4% de los perfiles. Es feo de leer en la barra y es la única forma que existe para los 15.171 nombres cirílicos.
- **Hay un paso de despliegue que no se puede olvidar**: `db:migrate` y después `backfill-name-fold`. Hasta que corra, `name_fold` es `null` en las filas viejas y la búsqueda por variante no las encuentra — no falla, no las encuentra, que es peor de detectar.
- **Cambiar la tabla de equivalencias del plegado obliga a rebobinar el backfill.** El job es idempotente y solo toca lo que no coincide, así que la palanca existe; lo que no existe es aviso automático de que hace falta.
- **`--character` del CLI admite ahora el nombre sin acentos y el reino con espacios**, y prueba la forma exacta antes que la plegada. Un comando guardado con la forma antigua sigue funcionando.
- **La decisión es barata de revisar mientras no haya nada indexado**, igual que la del ADR 0016 y con la misma fecha de caducidad: en cuanto la web publique, la regla 5 pasa a costar una migración de URL.
