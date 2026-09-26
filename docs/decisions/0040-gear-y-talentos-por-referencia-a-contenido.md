# ADR 0040 — El gear y los talentos se guardan por referencia a su contenido

**Fecha**: 26 de septiembre de 2026 · **Estado**: aceptada (issue #132; extiende al gear el [ADR 0035](0035-talentos-por-referencia-a-catalogo.md) y lo lleva un paso más en talentos)

## Contexto

La base está en **665 MB** contra la cuota de 500 del plan gratuito, y el 19 de octubre de 2026 Supabase restringe el proyecto. Además, el siguiente bracket que se quiere analizar es 2v2, así que no basta con bajar de la cuota: hay que dejar sitio.

Medido en producción el 26 de septiembre con `db-size --detail`:

- `character_snapshot_gear` ocupa **168 MB**: 628.212 filas de slot para 38.420 snapshots, a unos 212 bytes por fila. Lo que pesa es el contenido de cada fila —nombre del item, nombres de encantamientos y gemas, `bonus_list`— repetido.
- De esas 628.212 filas, **solo 65.432 son distintas (10,4%)**. La misma pieza —mismo item, item level, encantamientos, gemas y bonus en el mismo slot— la llevan miles de personajes, y el mismo personaje en cada refresco.
- En cambio, los equipos completos son distintos en un **94,9%**, y solo el **5,1%** repite exactamente el anterior del mismo personaje. Lo que se repite es la pieza, no el equipo.
- `character_snapshot_talents`, ya por árbol desde el ADR 0035, son 29 MB: 122.052 filas y **21.376 distintas (17,5%)**.

La issue #132 proponía dos palancas para el gear: nombres por catálogo, o no repetir un equipo idéntico al anterior del mismo personaje. La segunda, además de tocar qué es una observación ([ADR 0002](0002-modelo-append-only.md)), habría ahorrado un 5%.

## Decisión

1. **Una pieza de gear se guarda una vez**, en `gear_pieces`, con las mismas columnas que tenía la fila de slot, `slot` incluido. `TRINKET_1` y `TRINKET_2` con el mismo abalorio siguen siendo dos piezas, como eran dos filas.
2. **`character_snapshot_gear` pasa a una fila por snapshot** con `piece_ids int[]`. Conserva el nombre por lo mismo que la 0021: «el último snapshot con gear» es un `exists` sobre ella, y esa pregunta no cambia.
3. **Un árbol de talentos elegido se guarda una vez**, en `talent_sets` (árbol, `label_ids`, `ranks`), y `character_snapshot_talents` pasa a una fila por snapshot con `set_ids int[]`. Las etiquetas siguen en `talent_labels`.
4. **La identidad de una pieza o de un conjunto es una huella de todo su contenido**: `md5` del `json_build_array` de sus columnas, que calcula Postgres (`gear_piece_fingerprint`, `talent_set_fingerprint`) en una columna generada con índice único. JSON y no una concatenación, porque distingue un `null` de la cadena `'null'` y un array vacío de uno ausente (regla 5). Se usa la huella y no un índice único sobre las columnas porque ese índice ocuparía casi lo mismo que la tabla que se está quitando.
5. **Quien lee por slot o por árbol lee una vista con la forma de antes**: `character_snapshot_gear_slots` y `character_snapshot_talent_trees`, con las columnas y el orden de las tablas que sustituyen. La ficha, los agregados, `player-gap` y el archivado solo cambian el nombre de lo que leen.
6. **El archivo de Storage sigue escribiendo el formato de siempre**, porque lee de las vistas. Un lote de gear se lee sin `gear_pieces`: no se añade una segunda dependencia del archivo hacia una tabla viva, más allá de la que ya tenían los talentos con `talent_labels`.
7. **Los catálogos no son append-only ni se podan**, por lo mismo que `talent_labels` e `item_media`: no son la observación de nadie. Podarlos exigiría comprobar cada noche qué pieza no apunta ningún snapshot, y eso cuesta más de lo que ocupan.
8. **No cambia qué es una observación.** Cada perfil sigue insertando su snapshot y su fila de gear, aunque el equipo sea idéntico al anterior, y nada se actualiza. Ningún denominador cambia (`gear_sample`, `talent_node_sample`, `pvp_talent_sample`), y ninguna cifra publicada cambia de valor.

## Por qué 2v2 depende de esto

El equipo es del personaje, no del bracket. Con la forma anterior, un personaje que juega Solo Shuffle y 2v2 pagaría sus dieciséis filas de slot dos veces por cada refresco. Con esta, la segunda observación son unos 90 bytes de referencias a piezas que ya existen. El coste de un bracket nuevo deja de ser proporcional a cuánta gente lo juega y pasa a serlo a cuánto equipo **distinto** trae.

## Por qué no las alternativas

- **No repetir un equipo idéntico al anterior.** Ahorra el 5%, cambia qué es una observación y obliga a cuidar los denominadores. Descartada por la medición.
- **Catálogo de equipos completos.** El 94,9% de los equipos es distinto: el catálogo sería casi tan grande como lo que sustituye.
- **Catálogos de nombres sueltos** (items, encantamientos, gemas) dejando una fila por slot. Quita los textos, pero no las 628.212 cabeceras de fila y entradas de índice, que es lo mismo que el ADR 0035 descartó para los talentos.
- **Calcular la huella en TypeScript.** Tendría que coincidir carácter a carácter con la que calcula la migración sobre los datos existentes. Con una sola función en Postgres para las dos cosas, no hay dos implementaciones que puedan divergir.

## Consecuencias

- Medido sobre producción en un ensayo revertido (`npm run pipeline -- migrate --rehearse`, 26 de septiembre de 2026): el gear pasa de **168,0 MB a 25,0 MB** (5,6 de tabla y 19,4 de catálogo) y los talentos, de **29,0 a 9,8 MB** (2,9 y 6,9). `public` baja de **653,8 a 491,7 MB**. Las dos comparaciones pasaron sin una sola diferencia, y la 0022 tardó 60,7 s y la 0023, 10,0 s.
- Las migraciones 0022 y 0023 **comparan en los dos sentidos, con multiplicidad** (`except all`), cada fila de la vista con la tabla vieja antes de borrarla. Si una sola difiere, lanzan una excepción y la transacción entera se deshace.
- Mientras corren, la tabla nueva convive con la vieja hasta el commit: el pico medido en el ensayo es de **688,7 MB** en `public`, 35 por encima de lo que había. Supabase no restringe hasta el 19 de octubre, así que cabe. Durante esos 71 segundos las tablas de gear y talentos están bloqueadas.
- Escribir un perfil cuesta dos viajes más: el alta de piezas y la del conjunto de talentos. Si una pieza no se resuelve contra el catálogo, el perfil falla en vez de guardarse con una pieza de menos.
- `resolve-item-media` lee los items de `gear_pieces` en vez de recorrer el gear de cada snapshot.
- El índice `idx_gear_item`, 6 MB con 9 lecturas desde julio, desaparece con la tabla vieja y no se recrea: la agregación por item lee por snapshot, no por item.
