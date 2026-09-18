# Sprint 0 — hallazgos verificados

Estado de la validación de datos (Phase 0). Lo que aquí se da por bueno es lo que se ejecutó de verdad contra la API real; lo que está en duda se marca como tal, incluso cuando el issue correspondiente esté cerrado.

Actualizado: 22 de agosto de 2026.

## 1. Endpoints core — funcionan sobre las 13 clases

Los 4 endpoints responden de forma coherente en EU, validados sobre **15 personajes que cubren las 13 clases** (`validate-endpoints`, reporte en `reports/endpoint-validation-2026-08-14.json`):

| Endpoint                                                    | Resultado |
| ----------------------------------------------------------- | --------- |
| Character Profile                                           | ✅ 15/15  |
| PvP bracket statistics (vía `pvp-summary`)                  | ✅ 15/15  |
| Equipment summary (incluye gemas y encantamientos por slot) | ✅ 15/15  |
| Specializations (`talent_loadout_code`)                     | ✅ 15/15  |

La muestra anterior eran 3 personajes de 3 clases. Ahora cubre las 13, con **dos personajes en Priest y dos en Evoker**: son las clases que el foro oficial señalaba tras el parche 11.2, así que interesa más señal justo ahí.

Un personaje de la primera selección devolvió 404 en los cuatro endpoints — había desaparecido (rename, transfer o borrado) entre la descarga del leaderboard y la validación. Se sustituyó por otro vivo. Es rotación normal, no un fallo de la API, pero conviene saber que pasa.

## 2. Talentos — el riesgo de disponibilidad está cerrado; el de utilidad no

`talent_loadout_code` viene poblado en **15/15 personajes, en las 13 clases**, y en **594 de 595 perfiles** del muestreo por segmento (§4). El único ausente fue un 404 transitorio del endpoint, no un loadout sin código.

El riesgo del parche 11.2 (§30) queda cerrado: el campo existe y llega.

> ⚠️ **Pero disponible no es lo mismo que utilizable.** Al calcular el primer Player Gap real (§6.2) resultó que casi cada jugador tiene un código distinto, así que comparar por coincidencia exacta no produce ninguna señal. El plan de contingencia de §32 —lanzar con Player Gap solo de gear— **sigue sobre la mesa**, ya no por falta de dato sino por cómo está codificado.

> El issue #3 figuraba cerrado sin respaldo en el repo. Ahora sí lo tiene: `apps/pipeline/config/characters.eu.json` contiene los 15 personajes y el reporte es reproducible con `npm run pipeline -- validate-endpoints`.

**Salvedad de método**: `validate-endpoints` cuenta un 404 de perfil como fallo de talentos, así que un personaje desaparecido degrada el veredicto sin que haya ningún problema con los talentos. Al interpretar el resultado hay que mirar las notas, no solo la línea final.

## 3. Cobertura del leaderboard — depende mucho de la spec

> ⚠️ **Todo lo de esta sección es de la temporada 41, terminada el 19 de agosto de 2026, y describe el caso contrario al de hoy.** En una temporada recién empezada el tope de 5.000 no llega a aplicar y lo que falta es la parte alta, no la baja. Los números vigentes están en §12; la decisión de producto que salía de aquí, en §8.1.

Con 15.009 personajes ingeridos de 3 specs, el corte del top 5.000:

| Spec               | Cobertura fiable desde                               |
| ------------------ | ---------------------------------------------------- |
| Frost Mage         | ~1800 (spec muy jugada: el top 5.000 no baja de ahí) |
| Restoration Shaman | 1400                                                 |
| Fury Warrior       | 1200                                                 |

**Matiz importante que faltaba**: que el ladder de Frost Mage no baje de 1800 no significa que el tramo 1800-2000 esté poco poblado. Tiene 1.256 personajes, más que el de Shaman o Warrior. Lo que falta en Frost Mage es todo lo que hay _por debajo_ de 1800, no el borde inferior del ICP.

Población por segmento en los tramos que interesan hoy:

| Spec               | 1800-2000 | 2000-2200 |
| ------------------ | --------- | --------- |
| Frost Mage         | 1.256     | 1.360     |
| Restoration Shaman | 1.292     | 876       |
| Fury Warrior       | 1.056     | 630       |

**Consecuencia de producto**: la acumulación de población por búsqueda de usuario (§12 del plan) pasa de "requisito universal del MVP" a **requisito condicional según la popularidad de la spec**. Para specs muy jugadas no hay Player Gap creíble por debajo de 1800 sin ella.

~~**Consecuencia de diseño**: el ICP declarado es 1400-2200, pero en las specs más jugadas hoy solo se puede servir desde ~1800. O se lanza con specs de cobertura buena, o la acumulación por búsqueda entra antes del lanzamiento.~~ La disyuntiva no sobrevivió a medirla de nuevo: la acumulación por búsqueda ya está construida (#14) y el perfil de cobertura se invierte con el ciclo de la temporada. Decidido el 21 de agosto de 2026 — ver §8.1 y §12.

## 4. Muestreo de perfiles completos — hecho

`sample-profiles` (issue #8), 100 personajes por bucket en 1800-2000 y 2000-2200 sobre las 3 specs ingeridas. Muestreo aleatorio reproducible por semilla, no los primeros del ranking: coger la cabeza del bucket sesgaría cualquier `adoption_rate` calculado después.

Run `run-20260814T121556`: **595 snapshots con `source='profile'` y 9.775 filas de gear**.

| Spec               | Segmento  | n utilizable | Confianza |
| ------------------ | --------- | ------------ | --------- |
| Frost Mage         | 1800-2000 | 100          | high      |
| Frost Mage         | 2000-2200 | 100          | high      |
| Restoration Shaman | 1800-2000 | 99           | medium    |
| Restoration Shaman | 2000-2200 | 99           | medium    |
| Fury Warrior       | 1800-2000 | 97           | medium    |
| Fury Warrior       | 2000-2200 | 100          | high      |

Los 5 que faltan para 600 son personajes que ya no aparecen en su bracket. Es rotación real y sale del denominador: declarar confianza sobre perfiles que no se pudieron leer sería inflarla.

**Coste real y ritmo**: 4 peticiones por personaje. El ritmo efectivo fue de **~3,2 req/s**, no los 8 del limitador — el cuello de botella es la latencia acumulada (4 llamadas secuenciales más un insert por slot de gear contra Postgres remoto), no el throttling. Los 600 tardaron ~13 minutos.

**Censo, si alguna vez hace falta**: los dos buckets completos son 6.469 personajes ≈ 25.900 peticiones ≈ 2,2 horas al ritmo real. Cabe en el límite horario de 36.000 pero se lo come casi entero. No aporta nada a la pregunta de Phase 0 (n=100 ya es confianza `high`); serviría para el `adoption_rate` real de #21/#22, y a escala de 40 specs deja de ser viable.

## 5. Bug del catálogo de specs — encontrado al ampliar cobertura

`shuffleBracketId()` construía mal el bracket de **6 de las 39 specs**. Blizzard elimina los guiones internos de los slugs:

| Lo que generábamos             | Lo que la API acepta          |
| ------------------------------ | ----------------------------- |
| `shuffle-death-knight-frost`   | `shuffle-deathknight-frost`   |
| `shuffle-demon-hunter-havoc`   | `shuffle-demonhunter-havoc`   |
| `shuffle-hunter-beast-mastery` | `shuffle-hunter-beastmastery` |

Las formas con guion devuelven **404**, no una lista vacía. Estaba latente porque las 3 specs ingeridas no llevan guiones, pero habría hecho desaparecer death knight y demon hunter enteras al ampliar cobertura (#13) — y en silencio, porque `fetch-leaderboard` habría tratado el 404 como una spec sin datos.

El test que existía afirmaba el valor equivocado y pasaba en verde. Corregido en `packages/core/src/specs.ts`, con los tres casos verificados contra la API en la temporada 41.

> Lección de método: un test fija un error tan bien como un acierto cuando el valor esperado no se ha contrastado nunca con la fuente real.

## 6. Primer Player Gap real — hecho, con un hallazgo que cambia el plan

`player-gap` (issue #9), sobre el run `run-20260814T121556`. Un sujeto por spec, elegido con muestreo reproducible dentro de 1800-2000, comparado contra 2000-2200. Cálculo en `packages/core/src/player-gap.ts`; el job solo consulta y renderiza, para que la web de Phase 2 (#18) no tenga que reimplementar la fórmula.

| Sujeto               | Spec               | CR   | n objetivo | Confianza | Gear alineado | Diferencias |
| -------------------- | ------------------ | ---- | ---------- | --------- | ------------- | ----------- |
| Loode-ravencrest     | Frost Mage         | 1994 | 98         | medium    | 37%           | 5           |
| Collînna-aegwynn     | Restoration Shaman | 1994 | 99         | medium    | 27%           | 5           |
| Teyshwarr-archimonde | Fury Warrior       | 1829 | 97         | medium    | 33%           | 4           |

Reportes en `reports/player-gap-<run>-<reino>-<nombre>.{json,md}` (regenerables con `npm run pipeline -- player-gap`).

### 6.1 Gear: la señal existe y es reconocible

El criterio de éxito de §32 era cualitativo — que el resultado sea "lo que un jugador experto reconocería como razonable" — y se cumple: en las 3 specs, el gear de tier alto (_Galactic Gladiator's_) está sistemáticamente más adoptado en 2000-2200, y el de entrada (_Galactic Aspirant's_, _Thalassian Competitor's_) más abajo. No es un hallazgo sorprendente, y precisamente por eso sirve de validación: la tubería reproduce algo que ya se sabe cierto.

**El item level no discrimina**: las medianas de equipado son 245-247 abajo y 246-249 arriba. Lo que separa a los segmentos no es tener mejor gear, es _qué piezas concretas_ se llevan. Es un punto a favor del producto — el Player Gap no se reduce a "fárma más".

### 6.2 Talentos: `talent_loadout_code` está poblado, pero la comparación exacta no sirve

Este es el hallazgo importante, y **matiza el GO de la sección 2**:

| Spec               | Perfiles en 2000-2200 | Códigos distintos | Código más repetido |
| ------------------ | --------------------- | ----------------- | ------------------- |
| Frost Mage         | 98                    | 85                | 7 jugadores (7%)    |
| Restoration Shaman | 99                    | 95                | 3 jugadores (3%)    |
| Fury Warrior       | 97                    | 94                | 3 jugadores (3%)    |

Casi cada jugador tiene un código único. El código completo codifica el árbol entero, así que dos builds que difieren en un solo nodo cuentan como distintas y no se agrupa nada. Decir "el 3% de 2000-2200 usa esta build" es cierto y no significa nada: describe a tres personas.

**Que el dato esté disponible (sección 2) y que sea utilizable son cosas distintas, y solo lo primero estaba verificado.** La comparación por coincidencia exacta se queda en el reporte, pero marcada como sin señal (`hasUsableSignal: false`), y el texto explica la limitación **antes** de enseñar el top-3 — enseñar un 3% como si fuera el consenso del segmento es justo la conclusión engañosa que prohíbe §13.5.

**Consecuencia**: decodificar el loadout en nodos individuales (#24) deja de ser `mvp-plus`. Sin eso, Player Gap se sostiene solo sobre gear, y "Talents" del mockup de §13.1 no se puede pintar. Es la decisión de producto que sale de este issue.

> **Anotado el 4 de septiembre de 2026 ([ADR 0026](decisions/0026-talentos-por-nodo.md))**: el hallazgo de arriba se confirma con la población de #66 detrás —entre 75 y 97 códigos distintos por cada 100 perfiles, y 101 de los 140 pares servibles con la build más repetida por debajo del 10%—, pero **la conclusión sobre el coste era falsa**. No hacía falta decodificar nada: la respuesta de `/specializations` que ya descargábamos trae `selected_class_talents`, `selected_spec_talents`, `selected_hero_talents`, `selected_hero_talent_tree` y `pvp_talent_slots` ya resueltos por Blizzard. Solo los estábamos tirando, porque `SpecializationsResponse` modelaba únicamente el código.

### 6.3 Dos correcciones que salieron de leer los reportes

- **Abalorios y anillos se comparan por grupo, no por hueco**. `TRINKET_1`/`TRINKET_2` y `FINGER_1`/`FINGER_2` son intercambiables, y comparar por el slot literal partía la adopción del mismo item en dos: en la primera versión, el mismo abalorio de Fury salía a la vez como +16 puntos en `TRINKET_2` y −11 en `TRINKET_1`. Puro artefacto del orden en que la API devuelve el equipo, con toda la apariencia de un insight.
- **Se compara el item level equipado, no el medio**. `average_item_level` cuenta también lo mejor del banco y de las bolsas: difiere del equipado en el **57% de los perfiles** muestreados, y no es lo que el jugador lleva en la arena.

### 6.4 Límites declarados en cada reporte

- ~~**Sin ventana de actividad** (§27, #16)~~: hecho el 19 de agosto de 2026, ver sección 10. La población del reporte se filtra por actividad, medida desde el momento del run.
- **Sin stats secundarias ni embellishments**, que sí aparecen en el mockup de §13.1: el schema no los guarda y deducirlos por heurística sería inventar dato.
- **Solo es demostrable el salto 1800-2000 → 2000-2200**: es el único par de segmentos consecutivos muestreados. Por eso los 3 sujetos varían en spec y no en rango, al contrario de lo que pedía §32.
- **Poder discriminante degradado**: §13.3 lo define como varianza entre segmentos consecutivos, que con dos segmentos no dice nada. Se sustituye por un umbral de delta mínimo de 10 puntos porcentuales (`MIN_DISCRIMINATIVE_DELTA`), encapsulado en `isDiscriminative()` para poder volver a la varianza cuando haya un tercer segmento.

## 7. Lo que no está hecho

- **Refresco 24-48h**: repetir la descarga y comprobar que se detectan cambios reales (§32, días 11-12). No ejecutado.
- ~~**Ampliar a todas las specs** (#13)~~: hecho el 18 de agosto de 2026, ver sección 9.
- ~~**`adoption_rate` de producto** (#21, #22)~~: hecho. La agregación persistida existe desde #15 —esta línea se quedó atrás, que es el patrón contra el que avisa `CLAUDE.md`—, y el 4 de septiembre de 2026 se completó con lo que faltaba de las dos issues: los nodos de talento ([ADR 0026](decisions/0026-talentos-por-nodo.md)) y las gemas y encantamientos ([ADR 0027](decisions/0027-gear-por-item-gema-y-encantamiento.md)), que llevaban guardándose desde la migración 0002 sin que nadie los leyera. Lo de la sección 6 sigue siendo un reporte de Sprint 0, y ahora es una vía de cálculo entre dos: hay un test que comprueba que da lo mismo que la comparación sobre agregados.
- ~~**GO/NO-GO formal de Sprint 0** (#10)~~: el veredicto estaba en §8 desde el 18 de agosto; lo que faltaba eran las dos decisiones de producto que colgaban de él, tomadas el 21 de agosto de 2026 (#56). Este apartado seguía listándolo como pendiente con el issue ya cerrado — el patrón contra el que avisa `CLAUDE.md`.

## 8. Estado del veredicto

Según el criterio de §32:

- Rating: fiable ✅
- Gear: fiable ✅ (9.775 filas por slot, con gemas y encantamientos) y **con señal discriminante demostrada** (sección 6.1). Las gemas y los encantamientos que aquí solo se contaban como "vienen" también discriminan, medido el 4 de septiembre de 2026 sobre los mismos perfiles: 29-39 gemas y 48-57 encantamientos distintos por cada ~100 perfiles de un segmento —la mitad de dispersos que los códigos de loadout, y por eso agrupan— y diez diferencias por encima de los 10 puntos entre 1800-2000 y 2000-2200 ([ADR 0027](decisions/0027-gear-por-item-gema-y-encantamiento.md))
- Talentos: **disponibles ✅ pero no utilizables todavía** ⚠️ (sección 6.2) — el dato está, la comparación por código exacto no informa

Sigue dando para un **GO**: §32 lo condiciona a que rating y gear sean fiables, y ambos lo son con la comparación real ya hecha. Pero el GO es sobre un Player Gap **de gear**, no el de tres categorías del mockup.

De ahí colgaban dos decisiones de producto, no de datos. **Ambas tomadas el 21 de agosto de 2026 (#56)**, y con eso Phase 0 queda cerrada de verdad.

### 8.1 Decisión 1 — se lanza con las 40 specs y la cobertura decide (21 de agosto de 2026)

**No hay lista de specs de lanzamiento.** Se ingieren, muestrean y ofrecen las 40, y `canShowComparison()` decide por par `(spec, segmento objetivo)` si hay comparación o si se explica por qué no. Decisión completa, con la medición que la sostiene, en el [ADR 0010](decisions/0010-cobertura-por-segmento.md).

La disyuntiva que dejaba abierta §3 —"o specs de cobertura buena, o la acumulación por búsqueda antes del lanzamiento"— ya no existía cuando fuimos a contestarla:

- **La acumulación por búsqueda está construida** desde que se cerró #14 ([ADR 0006](decisions/0006-acumulacion-de-poblacion-por-busqueda.md)). Lo que falta no es el mecanismo, es el tráfico que lo alimente, y ese no existe antes de lanzar.
- **Los números de §3 son de una temporada terminada** y describen el caso contrario al de hoy (§12).
- **El cuello no era la lista de specs.** Hoy `population_segments` tiene 357 filas con n≥30 de población y `gear_sample = 0` en las 1.424: ninguna spec puede pintar un Player Gap, se elija la lista que se elija. Lo que desbloquea el lanzamiento es #66, no una selección de specs.

Tres consecuencias directas: #66 recibe su contrato de muestreo (cuota por par, objetivo 100, suelo 30, gasto de abajo arriba), el mínimo de lanzamiento se cuenta en **pares servibles** y no en specs —y es alcance de #73—, y #58 sube de prioridad porque el estado "sin comparación" deja de ser marginal.

### 8.2 Decisión 2 — se lanza sin la categoría "Talents" (21 de agosto de 2026)

**#24 no entra antes del MVP.** El Player Gap del lanzamiento es **de gear**, y se queda en `priority:mvp-plus`.

Es literalmente el plan de contingencia que §32 del plan ya contemplaba —"GO condicionado: se lanza MVP con Player Gap basado solo en gear/stats"— activado por un motivo distinto del previsto. §32 lo condicionaba a que el dato faltara; el dato está (§2, 594 de 595 perfiles), lo que no sirve es la comparación por código exacto (§6.2). El efecto sobre lo que se puede pintar es el mismo.

**Por qué no al revés**, teniendo el mockup de §13.1 cuatro barras:

- **Gear es la única categoría con señal discriminante demostrada** (§6.1), y stats secundarias y embellishments ni siquiera están en el schema. Meter #24 no daría las cuatro barras, daría dos.
- ~~**#24 es investigación de duración desconocida** —parsear el árbol de talentos de cada spec contra un formato que Blizzard no documenta como API— y ponerlo en el camino crítico ata la fecha de lanzamiento a algo sin estimar.~~ **Premisa errónea, corregida el 4 de septiembre de 2026** ([ADR 0026](decisions/0026-talentos-por-nodo.md)): Blizzard entrega los nodos decodificados en la misma respuesta que el código, así que no había parser que escribir ni cuota que gastar. Lo que sí sigue en pie es la otra razón —la comparación por código exacto no informa— y por eso el Player Gap del lanzamiento **sigue siendo de gear**: los nodos se agregan y se publican por segmento, y llevarlos a la caja es #18.
- **La categoría que falta no se disimula, se declara.** La comparación exacta se queda en el reporte marcada con `hasUsableSignal: false` y explicando la limitación antes de enseñar nada, que es lo que ya hace hoy.

Consecuencia inmediata: **#57 queda desbloqueado con la respuesta clara** —la caja "WHAT SEPARATES YOU FROM 2000+?" tiene **una sola categoría**, no cuatro—, y lo que #57 decide es qué enseña esa caja en esas condiciones. Las barras del mockup, con una sola categoría, dejan de tener sentido como forma; la lista de _biggest differences_ sí está completa y cumple el formato fijo de §13.6.

## 9. Ampliación a todas las specs (#13)

La ingesta pasa de 3 specs a las 40 del catálogo. Medido contra la temporada 41 en EU antes de tocar nada:

- **Había una spec 40 sin catalogar.** El índice de leaderboards publica `shuffle-demonhunter-devourer` con **5.003 entradas y corte en 1731**, y no estaba en `ALL_SPECS`. No es un caso marginal: es población de spec principal que el pipeline no ingería en ningún sitio. Para que no vuelva a pasar en silencio, cada corrida contrasta el índice contra el catálogo y avisa de lo que no sabe mapear (`unknownShuffleBrackets`).
- **Las specs de tanque sí tienen leaderboard**, al contrario de lo que cabría suponer de un modo sin rol de tanque: Blood 681, Vengeance 355, Guardian 1083, Brewmaster 563, Protection Paladin 1470, Protection Warrior 676. Se ingieren, pero con esas poblaciones sus buckets tardarán en llegar a n=30 y `canShowComparison()` los tapará. Es el comportamiento correcto, no un fallo de cobertura.
- **Las 39 specs que ya estaban en el catálogo responden 200 con datos.** Ninguna 404 ni lista vacía: el bug de la sección 5 está cerrado en la práctica, no solo en el test.
- **El volumen se multiplica por 11**: una publicación completa son **165.202 filas** frente a las 15.009 de 3 specs. El job corre cada 3h y solo ingiere cuando cambia el hash, así que el techo teórico es ~1,3M snapshots/día. Sobre `character_snapshots`, que es append-only por diseño (ADR 0002), eso es lo que hay que vigilar antes que la cuota de API: **está sin medir el ritmo real de publicación**, y de él depende si hace falta política de retención o rollup. Decisión consciente de medir primero.
- **La cuota de API deja de ser el límite del leaderboard y pasa a serlo del muestreo.** Descargar 40 specs son 42 peticiones por corrida, nada. Pero `sample-profiles` con los parámetros por defecto sobre 40 specs son ~32.000 peticiones, por encima del techo de 24.000/h: por eso el job acepta ahora `--specs` y toma la lista del manifiesto al reanudar, en vez de heredar la selección activa del pipeline.

## 10. Ventana de actividad (#16)

Al derivar `last_active_snapshot_date` de `season_match_statistics.played` (ADR 0008) salieron tres hechos que no estaban medidos, y los tres cambian cómo hay que leer todo lo anterior:

- **El contador del perfil y el del leaderboard no cuentan lo mismo.** De los 595 personajes con las dos fuentes para el mismo bracket y el mismo rating, el perfil da un número **menor en 595 de 595 casos** (60 en leaderboard frente a 10 en perfil, por ejemplo). No es ruido ni un desfase temporal: es sistemático. Restarlos daba 594 personajes "activos" que no habían jugado nada, así que el delta solo se calcula **dentro de la misma fuente**. Afecta a cualquier cosa futura que use `matches_played` como magnitud comparable, no solo a la actividad.
- **El leaderboard de una temporada terminada se congela.** En los **647.950** pares de snapshots consecutivos de la temporada 41 recogidos entre el 13 y el 19 de agosto de 2026 no hay **ni un solo** cambio de `matches_played` ni de `rating`, y aun así el ladder se republica cada ~3h. Todo lo que se calculó sobre "le hemos vuelto a ver" durante esos días estaba midiendo nuestra cadencia de descarga, no el juego.
- **La temporada 42 empezó el 19 de agosto de 2026 a las 09:12 UTC**, con 28-64 personajes por bracket y ratings entre 15 y 1815. El corte de temporada llegó, por tanto, en mitad de la ventana: el job agrega solo la vigente (§27) y avisa cuando hay dos.

**Consecuencia**: hoy el 100 % de la población entra en la ventana por primera observación (`first-seen`) y no por subida vista del contador. Está declarado en cada fila de `population_segments` (`active_by_delta` / `active_by_first_seen`) y el job lo dice al terminar. El primer `played-delta` real llegará cuando haya dos publicaciones de la temporada 42 con juego entre medias.

**Efecto colateral medido**: el 18 de agosto se ingirieron **447.851 snapshots** cuyo contenido no cambiaba en rating ni en partidas, así que la comprobación del ADR 0004 no filtraba este caso. No contamina la actividad —un contador que no sube no es actividad, se ingiera una vez o veinte—, pero sí el volumen. Resuelto el 20 de agosto de 2026 en el [ADR 0009](decisions/0009-ingesta-por-cambio-de-poblacion.md); ver §11.

## 11. Por qué se reingería el leaderboard (#53)

Al medirlo para arreglarlo apareció que la causa no era la que se había supuesto (el `rank` desplazándose con las altas y bajas del corte). De las **148 transiciones** entre publicaciones consecutivas de la temporada 41:

| Qué se movía entre una publicación y la siguiente                                                    | Transiciones |
| ---------------------------------------------------------------------------------------------------- | -----------: |
| Solo el `rank`                                                                                       |           36 |
| Altas o bajas de la lista (población de verdad)                                                      |           49 |
| **Nada de lo que guardamos** — ni rating, ni partidas, ni won/lost, ni tier, ni rank, ni altas/bajas |       **96** |

En dos tercios de los casos el payload cambiaba por algo que ni siquiera ingerimos. Por eso la huella que decide la ingesta se calcula ahora sobre la proyección exacta de lo que se guarda, ordenada por identidad, y no sobre el payload menos los campos que se nos vayan ocurriendo.

**Y en temporada viva un hash mejor no basta.** En la 42, **246 de 303** publicaciones traen algún cambio real de población —cualquier huella honesta diría "cambió" en el 81 % de las corridas—, pero solo el **18 %** de las filas de cada una lleva información nueva (8.391 de 45.793 pares consecutivos). El resto entra porque _otro_ jugador del bracket jugó. De ahí que el arreglo tenga dos piezas: la huella decide si se ingiere el bracket, y un filtro por fila decide qué se escribe.

**Estado de la tabla al hacer el cambio** (20 de agosto de 2026, EU): 840.240 filas y 264 MB en `character_snapshots`, de las cuales unas 650.000 no aportan información. No se borran aquí: es alcance de #48.

## 12. Cobertura real al empezar la temporada 42 (#56)

Medido el 21 de agosto de 2026 sobre EU al ir a contestar la decisión 1, porque toda §3 estaba escrita con números de la temporada 41 y esa temporada terminó el 19 de agosto. Snapshot más reciente por personaje y bracket, buckets de 200, sobre las 40 specs.

**La 42 no es una versión pequeña de la 41: es su inversa.**

| Segmento  | Specs con n≥30 en la 41 | Población 41 | Specs con n≥30 en la 42 | Población 42 |
| --------- | ----------------------: | -----------: | ----------------------: | -----------: |
| 1200-1400 |                      15 |        3.867 |                      20 |        1.567 |
| 1400-1600 |                      17 |        6.415 |                      17 |        1.496 |
| 1600-1800 |                      25 |       14.949 |                      21 |        1.940 |
| 1800-2000 |                      28 |       29.429 |                      12 |        1.161 |
| 2000-2200 |                      26 |       20.596 |                   **1** |      **287** |
| 2200-2400 |                      27 |       18.962 |                       0 |           81 |

Totales: 113.527 personajes en la 41 frente a 17.387 en la 42.

- **El tope de 5.000 no aprieta hoy.** La spec más poblada de la 42 tiene 1.817 personajes (Holy Priest). Es decir, el problema central de §3 —el tope cortando el rango bajo del ICP— **no existe al empezar una temporada**, y el rango 1400-1800 es hoy el mejor cubierto. Volverá cuando la ladder madure.
- **Lo que falta ahora es el techo.** 2000-2200 tiene 287 personajes en las 40 specs juntas, y solo una llega a n≥30.
- **Y eso es exactamente lo que rompe el Player Gap**, porque la comparación es contra el segmento **superior**, no contra el del sujeto. Pares servibles en la 42, contando en cuántas specs el segmento siguiente llega a n≥30:

| Segmento del sujeto | Specs con objetivo servible |
| ------------------- | --------------------------: |
| 1400-1600           |                          21 |
| 1600-1800           |                          12 |
| 1800-2000           |                       **1** |
| 2000-2200           |                           0 |

**La lista de specs "buenas" tampoco es estable.** Las 3 validadas en Sprint 0 no son las más pobladas de la 42: Holy Priest 1.817, Retribution Paladin 1.354, Arms Warrior 1.286; Frost Mage cae al puesto 12 con 662. Cualquier selección fija habría sido un compromiso con la foto de una semana. Esto es lo que decide la forma de la decisión 1 (§8.1, [ADR 0010](decisions/0010-cobertura-por-segmento.md)).

**El dato más incómodo, y el que de verdad bloquea el MVP**: los agregados del 20 de agosto tienen **1.424 filas en `population_segments`, 357 con n≥30 de población y `gear_sample = 0` en todas**. <sup>Corregido el 22 de agosto: esas dos cifras son el acumulado de la tabla entera, no la corrida del 20, que tuvo 400 filas y 144 con n≥30 — ver §13.1. El `gear_sample = 0` sí es de la corrida y se mantiene.</sup> Los 595 perfiles muestreados (§4) son de la temporada 41 y `refresh-aggregates` agrega solo la vigente (§10), así que **hoy no hay ni un solo segmento capaz de pintar un Player Gap**. No es un fallo: es el [ADR 0007](decisions/0007-agregados-por-segmento.md) haciendo lo que se le pidió, guardar `gear_sample` aparte de `sample_size` para que la falta de gear no se disfrace de población. Y es la razón por la que #66 es el prerrequisito real del MVP, no una tarea de infraestructura que pueda esperar a tener consumidor.

**Lo que queda sin vigilar**: la cobertura servible se mueve durante la temporada —sube según madura la ladder y se desploma en cada reinicio— y no hay nada que lo mida de forma continua. Los números de arriba son una foto sacada a mano para tomar una decisión. Sale como #74. <sup>Cerrado el 18 de septiembre de 2026 con el [ADR 0032](decisions/0032-cobertura-servible-medida-de-forma-continua.md): cada corrida de `refresh-aggregates` escribe la cobertura por par en `segment_coverage`, y `npm run pipeline -- coverage` lee la serie. Las tablas de arriba son el último número de esta sección que hubo que medir a mano.</sup>

> Lección de método, hermana de la de §5: un número medido contra la fuente real caduca igual que uno inventado si no se anota **cuándo** y **sobre qué estado del mundo** se midió. §3 no decía nada falso el día que se escribió.

## 13. Qué se puede servir hoy fuera de cobertura (#58)

Medido el 22 de agosto de 2026 sobre EU para contestar #58: **qué ve exactamente un jugador de 1650 el día del lanzamiento.** Todo lo de abajo sale de la corrida diaria de agregados `computed_at = 2026-08-22T05:41:36Z` (temporada 42) y de `character_snapshots`.

### 13.1 Corrección de dos números de §12

Las "1.424 filas en `population_segments`, 357 con n≥30" de §12 **no son la corrida del 20 de agosto**: son el acumulado de toda la tabla en el momento de mirarla. Cada corrida inserta un juego nuevo de filas y nunca actualiza el anterior ([ADR 0007](decisions/0007-agregados-por-segmento.md), punto 3), así que contar la tabla entera cuenta los mismos segmentos tantas veces como días lleva el job.

| Corrida     | Filas | Con n≥30 | Población | Acumulado de la tabla |
| ----------- | ----: | -------: | --------: | --------------------: |
| 19 ago (×3) |   198 |        0 |       746 |                   594 |
| 20 ago      |   400 |      144 |    11.306 |                   994 |
| 21 ago      |   430 |      213 |    17.944 |             **1.424** |
| 22 ago      |   439 |      257 |    23.654 |                 1.863 |

La cifra por corrida del día que se escribió §12 era **400 filas y 144 con n≥30**, no 1.424 y 357. La conclusión no cambia —`gear_sample = 0` en todas, en las tres corridas y en la de hoy— pero el tamaño del dato sí, y es el número que se cita en el contexto del [ADR 0010](decisions/0010-cobertura-por-segmento.md). Corregido ahí también.

Es la misma lección de §12 aplicada a nosotros mismos: un agregado append-only se lee por `computed_at`, nunca en total.

### 13.2 No hay ni un perfil dentro de la temporada vigente

En las 439 filas de la corrida del 22 de agosto:

| Denominador         |  Valor |
| ------------------- | -----: |
| `sample_size`       | 23.654 |
| `item_level_sample` |  **0** |
| `gear_sample`       |  **0** |
| `talent_sample`     |  **0** |
| `excluded_search`   |  **0** |

Cero perfiles significa cero en todo lo que la caja Player Gap pinta: ni la lista de diferencias, ni el solapamiento de gear, ni **la mediana de item level del segmento objetivo**, que no existe en ninguna de las 439 filas.

> **Superado el 4 de septiembre de 2026**: #66 llenó los denominadores. En la corrida del 29 de agosto hay **140 pares `(spec, segmento)` con `gear_sample >= 30`** y otros tantos con `talent_sample >= 30`. Lo que sí arranca de cero otra vez es `talent_node_sample`, que empieza a contar con la migración 0012 ([ADR 0026](decisions/0026-talentos-por-nodo.md)) y tarda unos diez días en alcanzar al resto. Es decir, al lanzar hoy la caja está en estado `insufficient` por la causa (b) del [brief](design/brief.md#15-los-tres-estados-de-confianza) —hay gente, no tenemos su equipo— en el 100 % de los casos, sin excepción.

### 13.3 La población sí llega, y llega justo donde vive el ICP

Distribución de la corrida del 22 de agosto, con las specs que alcanzan `MIN_SAMPLE_MEDIUM` en cada segmento:

| Segmento  | Brackets | Población | Con n≥30 | Con gear≥30 |
| --------- | -------: | --------: | -------: | ----------: |
| 1200-1400 |       35 |     2.019 |       23 |           0 |
| 1400-1600 |       35 |     1.910 |       24 |           0 |
| 1600-1800 |       37 |     2.504 |       25 |           0 |
| 1800-2000 |       36 |     1.648 |       16 |           0 |
| 2000-2200 |       30 |       400 |        4 |           0 |
| 2200-2400 |       26 |       127 |        0 |           0 |

Comparado con el 21 de agosto (§12), el techo sube deprisa: 2000-2200 pasa de 1 spec con n≥30 a 4, y de 287 personajes a 400 en un día. La banda alta se está llenando sola; la de gear no se llena sola.

### 13.4 Cuánta gente tendría objetivo, si tuviéramos su gear

Contando por par `(bracket, segmento del sujeto)` con el objetivo en el segmento inmediatamente superior ([ADR 0010](decisions/0010-cobertura-por-segmento.md), decisión 2):

| Segmento del sujeto | Sujetos | Objetivo poblado (n≥30) | Con Player Gap (gear≥30) |
| ------------------- | ------: | ----------------------: | -----------------------: |
| 1400-1600           |   1.910 |                   1.774 |                    **0** |
| 1600-1800           |   2.504 |                   1.995 |                    **0** |
| 1800-2000           |   1.648 |                     679 |                    **0** |
| 2000-2200           |     400 |                       0 |                    **0** |

Y por personaje real, sobre los 23.768 pares `(personaje, bracket)` observados en la temporada 42: **20.293 (85,4 %) tienen el segmento objetivo poblado y 0 tienen Player Gap.**

Los dos números importan por separado y dicen cosas distintas:

- **85,4 %** es lo que el producto podrá servir cuando #66 corra. El cuello no es la población.
- **0 %** es lo que sirve hoy. Y hoy no es un caso raro: es todo el mundo.

### 13.5 El caso de la issue: un jugador de 1650

De los 37 brackets con población en 1600-1800, **25 llegan a n≥30 en el segmento del sujeto**; de esos 25, **16 tienen 1800-2000 poblado y 9 no**. Ninguno de los 25 tiene gear.

Los tres primeros por población, y los tres últimos que aún no llegan:

| Bracket                       | n en 1600-1800 | n en 1800-2000 | Objetivo |
| ----------------------------- | -------------: | -------------: | -------- |
| `shuffle-priest-holy`         |            474 |            285 | poblado  |
| `shuffle-warrior-arms`        |            182 |            125 | poblado  |
| `shuffle-rogue-assassination` |            166 |            122 | poblado  |
| …                             |                |                |          |
| `shuffle-rogue-subtlety`      |             34 |             10 | no llega |
| `shuffle-monk-mistweaver`     |             33 |             23 | no llega |
| `shuffle-druid-feral`         |             31 |              9 | no llega |

Concretando en el bracket más poblado, que es el caso más favorable posible: un **Holy Priest a 1650** el 22 de agosto de 2026 está por encima de **1.598 de los 2.282** Holy Priest observados esta temporada (percentil 70), tiene **477** en su propio segmento y **286** en el de arriba, y el tope observado de su spec es 2.709. Nada de eso necesita un solo perfil: sale de la población del leaderboard, que es censo observado y no muestra.

Lo que **no** se le puede decir a ese jugador: qué lleva el segmento de arriba, cuánto item level le falta, ni ninguna de las cifras de contexto de [§1.3 del brief](design/brief.md#13-decisión--la-caja-es-una-lista-no-un-panel-de-barras).

### 13.6 `excluded_search` es cero, y no puede ser otra cosa todavía

La pregunta abierta del [ADR 0007](decisions/0007-agregados-por-segmento.md) —cuánta población nos deja fuera excluir `source = 'search'` del denominador— **hoy tiene respuesta y es cero**: 0 en las 439 filas de la corrida del 22 de agosto y 0 en las seis corridas que existen. En toda la base de datos hay **3 snapshots de búsqueda, de 2 personajes, los tres de la temporada 41**.

No es que la exclusión salga barata: es que el mecanismo que la haría cara —tráfico de usuarios buscándose— no existe antes de lanzar. Medir `excluded_search` hoy no informa la decisión, la pospone. Lo que sí se puede fijar hoy es cuándo deja de ser cero de forma relevante, y eso es el [ADR 0011](decisions/0011-fuera-de-cobertura-se-describe-no-se-compara.md).

Un detalle que la revisión tendrá que tener en cuenta cuando llegue: los snapshots de búsqueda **traen gear** ([lookup-character.ts](../apps/pipeline/src/jobs/lookup-character.ts)). La exclusión no deja fuera solo rating en 1400-1800; deja fuera el único gear que el tráfico puede aportar en el tramo que el leaderboard no cubre en temporada madura. Eso hace la decisión más cara de lo que parecía cuando se tomó, y es un argumento para el disparador, no contra él.
