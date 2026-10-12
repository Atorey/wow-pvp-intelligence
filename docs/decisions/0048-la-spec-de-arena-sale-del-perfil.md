# ADR 0048 — En 2v2 y 3v3 la spec sale del perfil, y lo que no tiene perfil no tiene spec

**Fecha**: 12 de octubre de 2026 · **Estado**: aceptada (issue [#34](https://github.com/Atorey/wow-pvp-intelligence/issues/34)) · Revisa el punto 4 del [ADR 0006](0006-acumulacion-de-poblacion-por-busqueda.md) · Se apoya en el [ADR 0010](0010-cobertura-por-segmento.md), el [ADR 0040](0040-gear-y-talentos-por-referencia-a-contenido.md), el [ADR 0045](0045-el-tope-del-leaderboard-se-declara-por-spec.md) y el [ADR 0046](0046-el-pipeline-no-baja-lo-que-no-usa.md)

## Contexto

Todo el modelo da por hecho que el bracket nombra la spec. `shuffle-mage-frost` es a la vez la serie de rating, el leaderboard que se descarga y el «Frost Mage» de los agregados. `class_slug` y `spec_slug` se sacan del bracket con `parseShuffleBracket()` y nunca de un campo de la API, y por eso ninguna clave de `population_segments` ni de `segment_coverage` lleva la spec. El ADR 0006 dejó fuera 2v2 y 3v3 precisamente por esto: «2v2» no nombra ninguna spec.

Lo que trae Blizzard para arena se midió el 12 de octubre de 2026 en EU, con una sonda de seis peticiones:

|                                             |                       2v2 |                       3v3 |
| ------------------------------------------- | ------------------------: | ------------------------: |
| Entradas publicadas                         |                     5.009 |                     5.002 |
| Rating del puesto 1 / 1.000 / 2.500 / 5.000 | 2940 / 2146 / 1983 / 1843 | 2977 / 2393 / 2162 / 1944 |
| 1800-2000                                   |                     2.677 |                       705 |
| 2000-2200                                   |                     1.543 |                     2.102 |
| 2200-2400                                   |                       583 |                     1.223 |
| 2400 o más                                  |                       206 |                       972 |

Hay dos hechos que cambian el modelo:

- **Ningún dato de arena trae la spec.** La entrada de leaderboard tiene personaje, facción, puesto, rating, partidas y tier, pero no clase ni spec. El `pvp-bracket/2v2` y el `pvp-bracket/3v3` del personaje tampoco la traen, mientras que el de Solo Shuffle sí lleva `specialization` porque el bracket ya es de una spec. La única fuente es el `active_spec` del perfil.
- **Es un solo leaderboard para todas las specs, y siempre está en el tope.** Las 5.000 entradas se reparten entre cuarenta specs, y el corte deja fuera el ICP por debajo de ~1850 en 2v2 y de ~1950 en 3v3.

La base llegó a 424 MB el 11 de octubre, sobre una cuota de 500 ([ADR 0047](0047-los-agregados-semanales-se-guardan-cuatro-semanas.md)). `compact` la bajó a 332 MB al día siguiente, pero sigue creciendo unos 4 MB al día. El egress del ciclo ya había pasado de los 5 GB por lecturas del pipeline ([ADR 0046](0046-el-pipeline-no-baja-lo-que-no-usa.md)). Cualquier modalidad nueva entra con ese margen.

## Decisión

1. **El bracket de arena se guarda con el id de Blizzard, `2v2` y `3v3`**, en la misma columna `bracket` que `shuffle-mage-frost`. Es lo que pide la API y lo que identifica la serie de rating del personaje. La ruta de la web tendrá su propio slug, como `solo-shuffle` frente a `shuffle-*` ([ADR 0020](0020-mapa-de-rutas-del-sitio.md)).
2. **La spec de una observación de arena es el `active_spec` del perfil bajado en esa captura**, venga del refresco de perfiles o de una búsqueda. No se deduce del Solo Shuffle del mismo personaje ni de ningún otro bracket. Que juegue Frost en Shuffle no dice con qué spec juega 3v3.
3. **Una observación de leaderboard de arena no tiene clase ni spec: las dos son `null`.** Es la regla 5: no está disponible, no es «ninguna». Las dos van juntas, porque sin perfil tampoco se conoce la clase.
4. **El schema lo hace cumplir** ([migración 0027](../../db/migrations/0027_spec_de_arena.sql)). `class_slug` y `spec_slug` admiten `null` en `character_snapshots`, pero un check solo lo permite en filas `source = 'leaderboard'` de `2v2` o `3v3`. Una fila de Solo Shuffle sin spec sigue siendo un error. Una modalidad nueva sin spec (RBG) entra cambiando el check, como cualquier otra decisión.
5. **Un segmento de arena es `(bracket, clase, spec, tramo)`.** Las claves únicas de `population_segments` y `segment_coverage` pasan a incluir `class_slug` y `spec_slug`. La clase entra porque el slug de spec no es único entre clases: `frost` es de mago y de caballero de la muerte. En Solo Shuffle no cambia nada: la spec ya iba implícita en el bracket.
6. **Un personaje de arena cuenta en la spec de su perfil más reciente del mismo bracket dentro de la ventana de agregación**, el mismo perfil del que salen su gear y sus talentos. Sin perfil en la ventana cuenta en la distribución del bracket, pero no en ninguna spec. Ese número se guarda y se declara, porque una población que solo existe para quien tiene perfil tiene que decir cuánta queda fuera (§2.5 del [brief](../design/brief.md)).
7. **Los perfiles de arena salen del mismo presupuesto diario que los de Solo Shuffle**, no de uno aparte. El planificador de `refresh-profiles` reparte las 6.000 peticiones entre todos los pares `(bracket, segmento)` con el orden del ADR 0010. En arena el par no sabe de antemano qué spec traerá cada perfil.
8. **En arena solo se escriben agregados por variable donde se pueden servir.** `aggregate_snapshots` lleva filas para un segmento de arena solo si su denominador pasa `canShowComparison()`. Los de debajo guardan su fila en `population_segments`, con denominadores y mediana, pero no sus cientos de variables.

## Por qué

**Porque la alternativa a `null` es inventar.** Hay dos maneras de rellenar la spec de una entrada de leaderboard sin perfil: copiar la del Solo Shuffle del personaje, o la del último perfil que tengamos de cualquier bracket. Las dos aciertan a menudo y fallan justo donde importa. Un sanador de Shuffle que juega dps en 2v2, o un jugador de dos specs, pasaría a contar en una spec que nadie le ha visto jugar en esa modalidad. Y ese error no se ve en el agregado. Es lo mismo que la regla del gear del ADR 0006, punto 7: se guarda lo observado para la spec que toca, no lo que hay a mano.

**Porque el sesgo que queda se puede declarar, y el otro no.** El `active_spec` es la spec con la que estaba el personaje al bajar el perfil, y alguien puede capturarse con su spec de Shuffle aunque juegue 3v3 con otra. Eso no se puede corregir con la API pública. Pero es un sesgo de cada observación concreta, se puede explicar en metodología y se reduce con perfiles frescos. Una spec deducida de otro bracket añadiría un segundo error con la misma etiqueta.

**Porque la clave tiene que decir lo que identifica la fila.** Con `(bracket, tramo)` como clave, el `3v3` de Frost Mage y el de Holy Paladin del mismo día chocarían. Meter la spec dentro del bracket (`3v3-mage-frost`) haría que el bracket dejara de ser lo que pide la API y lo que nombra la serie de rating, y obligaría a partirlo por guiones, que es lo que el [ADR 0016](0016-slug-canonico-de-spec.md) prohíbe.

**Porque el presupuesto compartido es lo que mantiene la cuota de Supabase quieta.** Las filas de perfil, de gear por referencia y de talentos por conjunto crecen con los perfiles que se bajan al día, no con los brackets que existen. Con el mismo presupuesto, la arena se reparte el espacio que ya ocupa Solo Shuffle. A cambio, Solo Shuffle refresca algo menos, y eso se verá en `segment_coverage` ([ADR 0032](0032-cobertura-servible-medida-de-forma-continua.md)).

**Porque guardar variables de un segmento que no se puede enseñar es pagar cuota por nada.** `aggregate_snapshots` ya es la tabla que más creció, y la arena multiplica los segmentos: cuarenta specs por dos brackets, la mayoría con pocos perfiles. Un segmento con 12 perfiles tiene casi tantas variables distintas como uno con 60, y ninguna se puede publicar por debajo de n=30. La fila de `population_segments` sí se guarda: es la que dice «no llega a muestra» y la que sostiene la tendencia del denominador.

## Consecuencias

- **Coste estimado**, por filas multiplicadas por ancho de fila, que se confirma con `db-size --detail` y `pg_stat_statements` tras la activación:
  - **Leaderboard**: 2 peticiones más por corrida y 10.000 entradas frente a unas 165.000 de Solo Shuffle. Con inserción por cambio ([ADR 0009](0009-ingesta-por-cambio-de-poblacion.md)) y la ventana caliente de 3 días ([ADR 0041](0041-la-ventana-caliente-la-fija-la-cache-del-leaderboard.md)), un +6 % en `character_snapshots`, `character_presence` y `character_activity`. Hasta 10.000 personajes nuevos en `characters`, unos 1-2 MB. La ingesta no devuelve filas (ADR 0046), así que su egress es casi nulo.
  - **Perfiles**: igual que ahora, por el punto 7.
  - **Agregados**: 5-10 MB más en `aggregate_snapshots` por el punto 8, sobre el techo de unos 47 MB.
  - **Egress diario**: los pares activos pasan de unos 114.000 a unos 124.000. `rebuildActivity` y las lecturas de `refresh-aggregates` crecen en esa proporción, unos 150-300 MB al mes.
- **El leaderboard de arena está siempre en el tope** (`isLeaderboardCapped()`, ADR 0045). Su población es un suelo en cualquier punto de la temporada. Además, la población de una spec de arena depende de a quién se ha bajado el perfil, así que **el reparto por spec de arena no se publica como el de Solo Shuffle**: mide el muestreo tanto como la modalidad. Qué enseña `/meta/3v3` se decide al construirla.
- **Por debajo de ~1850 en 2v2 y ~1950 en 3v3 solo entra quien se busque**, con el sesgo de `source = 'search'` y fuera del agregado (ADR 0006, ADR 0007). Lo más probable es que Player Gap de arena se sirva sobre todo en 2000-2400, y `canShowComparison()` lo decide por par.
- **El trabajo va por fases, una por PR**:
  1. Este ADR y la migración 0027, que no reescribe filas: quitar un `not null` y añadir un check `not valid` es solo catálogo, y las claves únicas nuevas se construyen sobre tablas de decenas de miles de filas.
  2. La ingesta de los leaderboards `2v2`/`3v3` y la búsqueda bajo demanda: `shuffleBracketsFromSummary` deja de descartar arena. Los tipos de `packages/data` que leen snapshots pasan a admitir clase y spec `null` cuando puedan llegarles filas de arena.
  3. Perfiles de arena dentro del presupuesto común.
  4. Agregados y cobertura de arena, con el contador de población sin spec del punto 6 y el corte del punto 8.
  5. La web: modalidades en `BRACKET_SLUGS`, rutas y copy con el sesgo del `active_spec`.
- **Nada de esto se activa en producción hasta medir el egress tras el ADR 0046.** El ciclo en curso ya está por encima de la cuota. Antes de añadir lecturas hay que ver en `pg_stat_statements` que las del ADR 0046 bajaron lo que prometían.
- El check de la migración 0027 es `not valid`: se aplica a cada fila nueva y no recorre las que ya hay. Las existentes lo cumplen igualmente, porque hasta ahora las dos columnas eran `not null`.
