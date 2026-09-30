# ADR 0035 — Las selecciones de talento se guardan por referencia a un catálogo

**Fecha**: 20 de septiembre de 2026 · **Estado**: aceptada (revisa la forma de almacenamiento del [ADR 0026](0026-talentos-por-nodo.md) sin tocar lo que mide) · **Lo que deja al descubierto lo resuelve el [ADR 0044](0044-la-variable-de-talentos-es-el-talento-elegido.md)**, que agrega por talento elegido

## Contexto

La base sigue por encima de la cuota de 500 MB del plan gratuito después del archivado del [ADR 0034](0034-historico-frio-archivado-en-storage.md). Medido el 20 de septiembre de 2026, ya compactadas `character_activity` y `character_presence`, la base está en **689 MB** y `character_snapshot_talents` es su tabla más cara: **201 MB**, de los que 75 son índice.

Lo que la hace cara no es el dato:

- **1.770.368 filas para 22.350 snapshots**: 79 filas por snapshot, unos 9 KB por perfil.
- **3.515 etiquetas distintas** en total. El resto es el mismo nombre repetido, más la cabecera de fila y la entrada de índice pagadas 1,77 millones de veces.

La forma de 0012 —una fila por selección, con el nombre dentro— era la traducción directa de «el nodo es la unidad» del ADR 0026. Mide lo que tiene que medir; lo que no aguanta es el tamaño.

## Decisión

1. **`character_snapshot_talents` pasa a una fila por `(snapshot, árbol)`**, con `label_ids int[]` y `ranks smallint[]` en paralelo, posición a posición. El árbol sigue siendo columna porque los tres denominadores del ADR 0026 se separan por él, y esa pregunta tiene que contestarse sin abrir los arrays.
2. **Las etiquetas van a `talent_labels`**, con id propio. No es append-only y no le aplica la regla 1, por lo mismo que a `item_media` ([ADR 0022](0022-catalogo-de-iconos-de-item.md)): no es la observación de nadie, es la etiqueta de un hecho del juego.
3. **La clave del catálogo es `(tree, node_id, name)`, no el nodo.** Es la decisión que no se ve venir y la que hay que entender antes de tocar nada; va en su propia sección.
4. **`talent_labels.talent_id` guarda el id del talento elegido**, que es lo que `tooltip.talent.id` trae y 0012 tiraba. Es de lo que el nombre es función. Nace a `null` en las 3.515 etiquetas migradas de 0012, que nunca lo guardaron —«no disponible», no «no tiene»— y **se rellena solo**: cada perfil que trae una de esas etiquetas la completa. Dejarlo a `do nothing` habría dejado la columna vacía justo en las etiquetas más comunes, que son las únicas en las que sirve de algo.
5. **El catálogo no se poda.** El archivo de Storage guarda `label_ids` y los resuelve contra esta tabla; borrar una fila dejaría ilegible una parte del histórico frío.
6. **La unidad de agregación no cambia.** Sigue siendo el nodo. Esto es una decisión de representación, no de producto: ninguna cifra publicada cambia de valor.

## Por qué la clave lleva el nombre

Lo natural era `talent_id → nombre`, como `item_media`. **No se puede**: el nombre no es función del nodo.

Un **nodo de elección** son dos talentos bajo el mismo id, y la API devuelve el nodo con el nombre del que el jugador escogió. En los datos de producción:

- **338 nodos** tienen dos nombres. El 62087 es «Ice Nova» en 1.737 observaciones y «Freezing Cold» en 67; el 62088 es «Ring of Frost» o «Mass Polymorph»; el 71916, «Nightmare» u «Horrify».
- Esos nodos aparecen en **los 22.350 snapshots**, y las variantes minoritarias son **29.018 observaciones**.

Un catálogo por nodo tendría que quedarse con una de las dos. Eso no es comprimir: es afirmar que 29.018 personas eligieron lo que no eligieron, y encima de forma invisible, porque el resultado sigue siendo una fila con un nombre plausible. Con la clave de tres columnas el catálogo sale a 3.515 filas y 0,58 MB, que es ruido frente a los 179 MB que ahorra.

`unique nulls not distinct` y no `unique` a secas porque el nombre ausente es una etiqueta más: la API deja un nodo por loadout sin tooltip, y con la semántica normal de `null` habría una fila de catálogo por cada snapshot.

## Lo que esto deja al descubierto y no arregla

La agregación identifica la variable por `tree:node_id` ([ADR 0026](0026-talentos-por-nodo.md)), así que **en un nodo de elección funde los dos talentos en una sola cifra**, etiquetada con el nombre que llegue primero. Ya pasaba antes de esta decisión y sigue pasando después: el almacenamiento dejó de perder el dato, pero el cálculo todavía no lo usa.

Importa porque es exactamente la frase que la regla 3 del proyecto vigila: «el 74% del siguiente segmento lleva X» con una X que son dos talentos distintos es una correlación mal contada. Lo que hay que decidir —y no decide este ADR— es si la unidad pasa a ser la selección en vez del nodo, que es revisar el ADR 0026 y no un cambio de representación. El dato para decidirlo ya está guardado.

## Por qué no las alternativas

**Un solo `int[]` codificado (nodo y rango empaquetados en el mismo entero).** Ahorra los 8 MB del segundo array y cuesta que ninguna consulta se pueda leer ni escribir a mano. La medición dice que la tabla se queda en 21,5 MB con dos arrays; pagar legibilidad por un 4% no sale.

**Catálogo por nodo, aceptando la pérdida en los 338.** Es lo que proponía la nota de traspaso antes de medir. Descartado arriba.

**Comprimir la tabla tal cual (`toast`, `fillfactor`).** No ataca el coste: son 1,77 millones de cabeceras de fila y de entradas de índice, y eso no lo toca ninguna opción de almacenamiento.

**No guardar el nombre y resolverlo contra la API al leer.** Gasta cuota de Blizzard en cada lectura para recuperar algo que ya teníamos, y deja la ficha del jugador dependiendo de que la API responda.

## Consecuencias

- La migración 0021 reescribe la tabla y borra la vieja en la misma transacción. Medido sobre producción en un ensayo revertido: **20,7 s, 201 MB → 21,5 MB de tabla más 0,58 MB de catálogo, 179 MB de ahorro**, con las 1.770.368 selecciones intactas y cero diferencias en los dos sentidos de la comparación.
- Mientras corre, la transacción necesita sitio para la tabla nueva sin haber soltado la vieja: unos 220 MB de pico.
- La escritura son dos viajes más por perfil: el alta de etiquetas y la resolución del conjunto. El alta no puede devolver el id de lo que ya estaba —su `do update` está acotado a las etiquetas sin `talent_id`, que es lo que hace que el relleno ocurra una vez por etiqueta y no una por perfil—, así que la resolución va aparte. Un `do update` sin condición sí devolvería el id, a cambio de reescribir las ~85 etiquetas de cada perfil sin cambiar nada, y eso hincha una tabla de 3.500 filas.
- El archivado sigue haciendo `select *` y no se entera, pero **lo que archiva ya no se entiende solo**: un lote de Storage necesita `talent_labels` para leerse. Es la primera dependencia del archivo hacia una tabla viva.
