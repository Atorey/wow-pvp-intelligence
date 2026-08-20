# Sprint 0 — hallazgos verificados

Estado de la validación de datos (Phase 0). Lo que aquí se da por bueno es lo que se ejecutó de verdad contra la API real; lo que está en duda se marca como tal, incluso cuando el issue correspondiente esté cerrado.

Actualizado: 18 de agosto de 2026.

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

**Consecuencia de diseño**: el ICP declarado es 1400-2200, pero en las specs más jugadas hoy solo se puede servir desde ~1800. O se lanza con specs de cobertura buena, o la acumulación por búsqueda entra antes del lanzamiento. Es una decisión de producto, no técnica, y sigue sin tomarse.

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
- **`adoption_rate` de producto** (#21, #22): lo de la sección 6 es un reporte de Sprint 0, no la agregación persistida que consumirá la web.
- **GO/NO-GO formal de Sprint 0** (#10).

## 8. Estado del veredicto

Según el criterio de §32:

- Rating: fiable ✅
- Gear: fiable ✅ (9.775 filas por slot, con gemas y encantamientos) y **con señal discriminante demostrada** (sección 6.1)
- Talentos: **disponibles ✅ pero no utilizables todavía** ⚠️ (sección 6.2) — el dato está, la comparación por código exacto no informa

Sigue dando para un **GO**: §32 lo condiciona a que rating y gear sean fiables, y ambos lo son con la comparación real ya hecha. Pero el GO es sobre un Player Gap **de gear**, no el de tres categorías del mockup. Lo que queda abierto son dos decisiones de producto, no de datos:

1. Con qué specs se lanza, o si la acumulación por búsqueda entra antes (sección 3).
2. Si #24 (decodificar talentos) entra antes del MVP o se lanza sin la categoría "Talents".

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
