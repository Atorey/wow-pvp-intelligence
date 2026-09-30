# ADR 0044 — La variable de talentos es el talento elegido, no el nodo

**Fecha**: 30 de septiembre de 2026 · **Estado**: aceptada (issue #135) · **Revisa el punto 1 del [ADR 0026](0026-talentos-por-nodo.md)** y resuelve lo que el [ADR 0035](0035-talentos-por-referencia-a-catalogo.md) dejó al descubierto sin arreglar

## Contexto

Un **nodo de elección** son dos talentos con el mismo id: el 62087 es «Ice Nova» o «Freezing Cold», y el 62088 es «Ring of Frost» o «Mass Polymorph». El ADR 0035 dejó de perder ese dato al guardarlo, porque clava el catálogo por `(tree, node_id, name)`, pero la agregación seguía identificando la variable por `${árbol}:${nodo}`. En esos nodos salía **una sola cifra para dos talentos, con el nombre del primero que llegara**.

La ficha compara al jugador con el segmento por esa misma clave, así que el error llegaba a la caja Player Gap. Un mago frost que elige Freezing Cold en el 62087 aparecía como que ya «lleva» el nodo que el 90% de su tramo objetivo lleva etiquetado «Ice Nova». La caja no le enseñaba ninguna diferencia o, según la etiqueta que tocase, le enseñaba un talento que no había elegido. Es exactamente la frase que vigila la regla 3: «el 74% del siguiente segmento lleva Ice Nova», cuando parte de ese 74% lleva Freezing Cold, es una correlación mal contada. Y un jugador de PvP lo ve a la primera, que es justo lo que la beta cerrada viene a preguntar.

Medido en producción el 30 de septiembre de 2026, sobre el último perfil de cada personaje de los 14 días que lee `refresh-aggregates`:

|                                                             |                  |
| ----------------------------------------------------------- | ---------------- |
| Perfiles con talentos                                       | 16.147           |
| Variables de nodo, por bracket                              | 4.373            |
| Las mismas, contadas por selección                          | **4.861** (+11%) |
| Nodos con las dos opciones observadas, por bracket          | 488              |
| De esos, con base ≥ 30 y la opción minoritaria en **≥ 10%** | **170**          |

La última fila es la que importa. En 170 nodos la opción que la cifra fundida escondía pesa lo bastante como para superar `MIN_DISCRIMINATIVE_DELTA` por sí sola. No es un caso raro que solo pasa en los márgenes.

## Decisión

1. **La variable `talent-node` es la selección: el talento elegido en un nodo.** En un nodo de elección cada talento tiene su propia adopción y su propio nombre. Revisa el punto 1 del ADR 0026, que decía «el nodo», y no toca los puntos 2 a 8.
2. **La selección se identifica con `talent_labels.talent_id`, no con el nombre.** Es el id del talento elegido que la API trae en `tooltip.talent.id`, y del que el nombre es función ([ADR 0035](0035-talentos-por-referencia-a-catalogo.md), punto 4).
3. **La clave es `${árbol}:${nodo}:${talento}`**, y la construye `talentSelectionKey()` en `packages/core`. La usan la agregación y la ficha: la misma función en los dos lados, porque si cada uno la escribiera por su cuenta la marca de «lo llevas» dejaría de aparecer sin que nada fallase.
4. **Una selección sin `talent_id` es `${árbol}:${nodo}:?`, una variable propia.** Significa «un talento de ese nodo, sin saber cuál»: no se funde con ninguna de las selecciones conocidas ni se descarta.
5. **Los talentos PvP conservan `pvp:${id}`.** Ahí el talento ya es el nodo, su cifra nunca fundió nada y su serie sigue siendo comparable.
6. **Los denominadores no cambian.** `talent_node_sample` sigue contando a quien tiene nodos leídos. Quien eligió Ice Nova no lleva Freezing Cold y cuenta en la base de Freezing Cold con adopción 0: eso es un hecho observado, no un «no disponible».
7. **`aggregate_snapshots.talent_id` sigue guardando el nodo.** Las dos selecciones de un nodo de elección comparten ese valor, y lo que las separa es la clave. No hay migración ni columna nueva.
8. **Las corridas anteriores no se reescriben.** Sus filas describen lo que se midió con la unidad de entonces.

## Por qué la selección

El ADR 0026 justificó el nodo con una analogía: «el nodo es a los talentos lo que el `item_id` es al gear». Vale para los nodos que solo tienen una opción, que son casi todos, y no vale en un nodo de elección. Ahí el nodo es un **hueco**, como `TRINKET`, y el talento es lo que se pone en él. Agregar por nodo en esos casos es como agregar por slot: dice que casi todo el mundo lleva _algo_ en la cabeza, y eso no describe a nadie.

Lo que la caja Player Gap afirma es «el X% del siguiente segmento lleva esto». Esa frase solo es verdad si «esto» es un talento, porque no se puede llevar un nodo. Y la comparación con el jugador solo es honesta si compara lo que eligió él con lo que eligió el segmento.

## Por qué `talent_id` y no el nombre

Hoy los dos identifican lo mismo: ningún `talent_id` del catálogo tiene dos nombres ni cuelga de dos nodos. La diferencia está en qué pasa cuando cambian. Blizzard renombra talentos en los parches, y el catálogo, que se clava por nombre, da de alta una etiqueta nueva con el **mismo** `talent_id`. Con la clave por nombre, un renombrado a mitad de la ventana de 14 días partiría la adopción de un mismo talento en dos filas, cada una más baja que la real, y la variación entre corridas lo leería como un talento que desaparece y otro que aparece. Con `talent_id` la clave no se entera del cambio. El nombre sirve para etiquetar la fila, no para identificarla, igual que en el gear.

El coste era el que anticipaba la issue: `talent_id` nace a `null` en las 3.515 etiquetas migradas de la 0012 y se rellena a medida que llegan perfiles. Medido, ese coste ya casi no existe:

- **75 selecciones con nombre y sin `talent_id`, en 21 de los 16.147 perfiles.** Son 75 de 1.278.568 selecciones.
- Todas vienen de perfiles anteriores al 20 de septiembre: cualquier etiqueta observada desde la migración 0021 ya se rellenó. La ventana de agregación deja atrás esa fecha el **4 de octubre de 2026**, y a partir de ahí el residuo es cero por construcción.

## Por qué la selección desconocida es una variable y no se descarta

Hay otro «sin `talent_id`» que no es residuo: los nodos que la API devuelve **sin tooltip**. Son 41 etiquetas y unas 16.600 selecciones, más o menos una por perfil, y ninguna comparte nodo con una etiqueta con nombre, así que no son nodos de elección. Descartarlas perdería algo observado (regla 5). Fundirlas con una selección conocida afirmaría un talento que no se observó, que es el error que esta decisión corrige.

Por eso llevan `?`: el nodo se observó y el talento no. En la práctica esos nodos se comportan igual que antes, con una variable cada uno, y solo cambia la forma de su clave.

## La transición

La variación entre corridas ([ADR 0037](0037-la-tendencia-se-mide-contra-el-ruido-de-su-propia-base.md)) empareja filas por `(kind, variable_key)`. Si una clave nueva pudiera coincidir con una vieja, la primera corrida emparejaría la cifra que fundía dos talentos con la de uno solo. En el 62087 eso sería pasar del 95% «de Ice Nova» al 50% de Ice Nova: una bajada de 45 puntos que nadie jugó, pintada como un movimiento del segmento.

No puede pasar porque las claves de nodo cambian de forma: antes tenían dos partes y ahora tienen tres. Ninguna clave nueva de `talent-node` es igual a una vieja, y hay un test que lo fija. La consecuencia es la que el punto 7 del ADR 0037 ya prevé para cualquier variable sin pareja: sale sin variación, no como subida desde cero. Las filas de talentos pasan una semana sin variación, hasta que la poda conserve una corrida con la clave nueva. La línea que fecha la comparación sigue diciendo contra qué corrida se mide.

Los talentos PvP no cambian de clave ni de cifra, así que su variación sigue funcionando sin pausa.

## Por qué no las alternativas

**Clave por nombre, `(tree, node_id, name)`.** Hoy está completa y el `talent_id` todavía no del todo, pero la diferencia son 21 perfiles y se acaba el 4 de octubre. A cambio, cada renombrado partiría la adopción de un talento en dos. Se descarta por la sección de arriba.

**Mantener el nodo y etiquetarlo con los dos nombres** («Ice Nova / Freezing Cold»). Hace visible el problema sin arreglarlo. La cifra sigue siendo de dos talentos, y la caja sigue diciendo que quien eligió uno lleva lo que lleva el segmento.

**Una columna nueva en `aggregate_snapshots` con el talento elegido.** Ninguna lectura la necesita: quien pinta usa la clave para emparejar y el nombre para etiquetar. Añadirla sería una migración sobre la tabla que más crece, con la base pendiente de la cuota de Supabase, para guardar lo que la clave ya lleva.

**Recalcular las corridas viejas con la clave nueva.** Casi todo su detalle está podado y los snapshots de los que salieron están archivados en Storage. Y no hace falta: una fila sin pareja ya se trata como «no disponible».

## Consecuencias

- **`aggregate_snapshots` crece en torno a un 11% en las filas `talent-node`**, de unas 27.500 por corrida a unas 30.500. La poda se ocupa de ellas igual que de todas.
- **La página de segmento enseña dos filas donde había una** en los nodos de elección, cada una con su nombre y dentro de su árbol. No hay que tocar la maqueta: el brief ya reservaba una fila de la misma lista para cada variable de talento.
- **El copy deja de decir «nodo a nodo»**: los porcentajes se cuentan «talento a talento», y la lista de la caja pasa a llamarse «los talentos más frecuentes».
- **El dataset de desarrollo no tiene nodos de elección** ([ADR 0018](0018-dataset-de-desarrollo.md)): cada nodo sembrado tiene un solo talento. El caso lo cubren los tests de core y de la ficha. Sembrarlo es trabajo aparte si hace falta verlo en pantalla.
- **La advertencia de talentos de `CLAUDE.md` cambia**: la variable que agrupa ya no es el nodo, es el talento elegido en él.
