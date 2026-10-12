# ADR 0050 — La web publica la arena que ingiere el pipeline, por spec y sin reparto

**Fecha**: 12 de octubre de 2026 · **Estado**: aceptada (issue [#34](https://github.com/Atorey/wow-pvp-intelligence/issues/34)) · Cierra lo que el [ADR 0048](0048-la-spec-de-arena-sale-del-perfil.md) dejó para la web · Amplía el [ADR 0020](0020-mapa-de-rutas-del-sitio.md) y el [ADR 0038](0038-la-pagina-de-meta-publica-lo-que-la-muestra-sostiene.md)

## Contexto

Con las fases 1 a 4 del ADR 0048, el pipeline ingiere 2v2 y 3v3, baja sus perfiles y los agrega por spec, todo detrás de `BLIZZARD_ARENA_BRACKETS`. La web seguía siendo de una sola modalidad:

- `BRACKET_SLUGS` tenía un miembro.
- Las lecturas de `population_segments` daban por hecho que el bracket fija la spec.
- El perfil se organizaba por spec, con un bracket por spec.
- El copy decía «este sitio solo lee Solo Shuffle».

El ADR 0048 dejó tres cosas por decidir al construir la web: qué enseña `/meta/3v3`, contra quién se calcula la posición de un personaje de arena y cómo se enseña el sesgo del `active_spec`.

## Decisión

1. **El catálogo sabe construir la arena y el interruptor decide si se publica.** `BRACKET_SLUGS` es `solo-shuffle`, `2v2` y `3v3`, con `bracketIdFor()` y su inverso `bracketSlugFor()` como únicos puentes con la columna. Qué modalidades enseña la web lo dice `publishedBrackets()`, que lee **la misma** `BLIZZARD_ARENA_BRACKETS` que el leaderboard, los perfiles y los agregados. Con la arena apagada:
   - `/spec/{spec}/3v3` y `/meta/3v3` son 404;
   - no salen en el sitemap ni en ningún selector;
   - el copy nombra solo lo que se lee.
2. **Toda lectura de escalones lleva la spec en la clave.** `SegmentKey` y la caché de proceso incluyen `classSlug` y `specSlug`, también en Solo Shuffle, donde el filtro es redundante. Un solo camino es más seguro que dos que divergen en el bracket.
3. **El perfil se organiza por (spec, modalidad).** La spec de arena es la última que se le observó en ese bracket, con su fecha, y se declara junto a la ficha. Una modalidad de arena sin spec observada no entra en el selector. Su rating sí se enseña, en «Otras modalidades». La página abre en Solo Shuffle aunque la arena tenga más rating, y `?bracket=` acompaña a `?spec=` solo en arena.
4. **La posición en arena cuenta el bracket entero, todas las specs.** El leaderboard de arena no trae spec, y por spec solo contaría a quien tiene perfil. La frase lo dice («de todas las specs»), y los tamaños de segmento por spec no se ponen al lado. **Player Gap sí se compara dentro de la spec**, contra el segmento de arriba de esa spec en esa modalidad.
5. **`/meta/{arena}` enseña la población del bracket por tramo, sin reparto por spec.** Dos columnas: con spec conocida y sin ella. Debajo van las entradas del leaderboard, que en arena está siempre en el tope, y el porqué de que no haya reparto. Las páginas de spec de arena no dan puesto en la modalidad, por la misma razón.
6. **Cada página de arena dice de dónde sale la spec y cuántos se quedan sin ella** (`without_spec`), encima de las cifras y no al pie, porque cambia lo que significa cada una.

## Por qué

**Porque una página sin datos que se puede indexar es peor que un 404.** Si la web publicara 3v3 por estar en el catálogo, un despliegue con el interruptor apagado tendría cuarenta páginas de spec vacías anunciadas en el sitemap y un «este sitio lee 3v3» falso. Atar la publicación a la misma variable que el pipeline hace imposible que los dos lados digan cosas distintas.

**Porque el reparto por spec de arena mide nuestro muestreo.** En Solo Shuffle la población de una spec es la de su leaderboard. En arena es la de quien tiene perfil, y a quién se le baja el perfil lo decide `refresh-profiles` con su cuota (ADR 0049). Una tabla de specs ordenada por esa cifra se leería como el meta de 3v3 y sería el orden de nuestro censo. La población por tramo, partida en con y sin spec, sí describe el bracket.

**Porque la posición contra el bracket es la que el jugador reconoce.** El puesto de 3v3 que publica Blizzard es entre todas las specs. Contar solo a los de su spec con perfil daría un percentil sobre una población que cambia con nuestro muestreo y que el jugador no puede comprobar.

## Consecuencias

- **La web y el pipeline tienen que leer el mismo valor.** En Netlify hay que poner `BLIZZARD_ARENA_BRACKETS` igual que en las variables del repositorio, y no antes de que los agregados de arena tengan base. Encenderla en la web con el pipeline apagado da páginas de arena con la explicación de la ausencia, no un error.
- **La metodología cambia con lo publicado.** El párrafo de arena solo aparece si la arena se lee. Es configuración del despliegue, así que la página se sigue generando en build.
- **El build de la web no se ha podido comprobar en el entorno donde se escribió esto** (no descarga las fuentes de Google). Typecheck y tests sí.
- RBG y BG Blitz siguen siendo nombres sin slug. Entrar es un ADR como este, no una línea en `BRACKET_SLUGS`.
