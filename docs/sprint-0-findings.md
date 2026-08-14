# Sprint 0 — hallazgos verificados

Estado de la validación de datos (Phase 0). Lo que aquí se da por bueno es lo que se ejecutó de verdad contra la API real; lo que está en duda se marca como tal, incluso cuando el issue correspondiente esté cerrado.

Actualizado: 14 de agosto de 2026.

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

## 2. Talentos — riesgo cerrado

`talent_loadout_code` viene poblado en **15/15 personajes, en las 13 clases**, y en **594 de 595 perfiles** del muestreo por segmento (§4). El único ausente fue un 404 transitorio del endpoint, no un loadout sin código.

Esto es un **GO**: Player Gap puede incluir talentos. El plan de contingencia de §32 (lanzar solo con gear/stats) deja de estar sobre la mesa.

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

**Censo, si alguna vez hace falta**: los dos buckets completos son 6.469 personajes ≈ 25.900 peticiones ≈ 2,2 horas al ritmo real. Cabe en el límite horario de 36.000 pero se lo come casi entero. No aporta nada a la pregunta de Phase 0 (n=100 ya es confianza `high`); serviría para el `adoption_rate` real de #21/#22, y a escala de 39 specs deja de ser viable.

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

## 6. Lo que no está hecho

- **Refresco 24-48h**: repetir la descarga y comprobar que se detectan cambios reales (§32, días 11-12). No ejecutado.
- **Primer Player Gap real**: los datos ya están en la base de datos; falta el cálculo (#21, #22).
- **Ampliar a todas las specs** (#13), ahora ya sin el bug del catálogo bloqueándolo.
- **GO/NO-GO formal de Sprint 0**.

## 7. Estado del veredicto

Según el criterio de §32:

- Rating: fiable ✅
- Gear: fiable ✅ (9.775 filas por slot, con gemas y encantamientos)
- Talentos: fiable ✅ (13/13 clases, 594/595 perfiles)

Da para un **GO**, sin la condición que arrastraba desde la primera versión de este documento. Lo que sigue abierto no es la fiabilidad de los datos, sino la decisión de producto de la sección 3: con qué specs se lanza, o si la acumulación por búsqueda entra antes.
