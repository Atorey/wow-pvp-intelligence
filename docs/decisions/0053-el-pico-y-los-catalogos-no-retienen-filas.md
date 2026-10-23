# ADR 0053 — El pico se hereda en la actividad y los catálogos se podan

**Fecha**: 23 de octubre de 2026 · **Estado**: aceptada · **Revisa** el punto del [ADR 0034](0034-historico-frio-archivado-en-storage.md) que conservaba el pico de cada serie, y el [ADR 0040](0040-gear-y-talentos-por-referencia-a-contenido.md) en que `gear_pieces` y `talent_sets` no se podaban · Sigue al [ADR 0052](0052-lo-que-solo-se-lee-por-su-ultima-fila-se-poda.md)

## Contexto

El ADR 0052 quitó lo que no leía nadie y dio algo más de una semana de margen. Lo que queda creciendo es población: cada serie `(personaje, bracket, temporada)` cuesta unos 2,2 KB repartidos entre tablas, y entran unas 1.000 al día. El `db-size --detail` del 23 de octubre de 2026 desglosa lo que cada serie retiene fuera de la ventana caliente:

- **`character_snapshots`**: 164.867 filas de leaderboard conservadas fuera de la ventana para 138.182 series, más 41.795 de perfil. Por encima del ancla (~1 por serie), lo que sobra es sobre todo el **pico**: la fila de rating más alto de la temporada, que el archivado conservaba para que `readPeakRating` pudiera leer el máximo. Cada jugador que baja de su pico deja una fila completa, con sus índices, para guardar un entero.
- **Catálogos**: de 93.091 piezas de `gear_pieces`, solo 73.872 las apunta alguna fila; de 37.987 conjuntos de `talent_sets`, 28.447. El resto es equipo que ya no lleva nadie y que se quedó al archivarse su snapshot. El ADR 0040 no los podaba, pero el archivo no los necesita: el gear se sube desplegado por slot (`character_snapshot_gear_slots`) y los talentos con `label_ids`, que dependen de `talent_labels` y no de `talent_sets`.

## Decisión

1. **El pico deja de retener su fila.** El archivado escribe el máximo de lo que saca en `character_activity.archived_peak_rating` (migración 0031), en la misma transacción que borra, igual que `archived_observations`. `readPeakRating` devuelve el mayor entre eso y el máximo de lo que sigue en `character_snapshots`.
2. **Lo que se conserva fuera de la ventana es el ancla de cada origen, la última fila con gear y la última con talentos.** Nada más.
3. **`archive-snapshots` poda al terminar las entradas de `gear_pieces` y `talent_sets` que no apunta ninguna fila.** Cada catálogo va en su transacción, con `lock table … in share row exclusive mode`: choca con el `row exclusive` del alta de perfiles (`writeByReference`), y así ninguna ingesta queda apuntando a una pieza borrada. `talent_labels` sigue sin podarse: el archivo la necesita.
4. **`--dry-run` cuenta lo que se podaría** sin bloquear ni borrar.

## Por qué

**Porque el pico se puede heredar exactamente.** Un máximo es monótono: el de toda la serie es el mayor entre el de lo archivado y el de lo caliente, igual que el recuento de observaciones es su suma. La fila de actividad ya existe para guardar lo que se sabía de la mitad archivada (ADR 0034), y el archivado ya la actualiza en la transacción del borrado. No hace falta rellenar nada: hasta hoy el pico nunca se archivaba, así que todo lo archivado antes está por debajo de un pico que sigue en Postgres, y lo anotará el archivado cuando lo saque.

**Porque el catálogo es caché de contenido, no histórico.** Una pieza que no apunta nadie no se lee desde ninguna pantalla ni desde el archivo. Si alguien vuelve a llevarla, el alta la crea otra vez con otro id, que es lo que ya pasaba con cualquier pieza nueva.

## Consecuencias

- **Una vez:** unos 9 MB de catálogos (en proporción a lo que sobra de cada uno) y las filas de pico que no son ancla ni último gear. Se estimaron en unas 30.000 (~15 MB), pero el número lo dirá el primer `archive-snapshots --dry-run`. Lo borrado no vuelve a la cuota hasta un `compact` ([ADR 0034](0034-historico-frio-archivado-en-storage.md)).
- **Por día:** el catálogo deja de acumular equipo que ya no se lleva, y una serie que baja de su pico ya no deja una fila más.
- **Una temporada cerrada no cambia nada:** su fila de actividad se archiva entera con la columna nueva.
- **El alta de perfiles espera** mientras se poda un catálogo. Es un anti-join sobre unas 750.000 referencias, menos de un segundo.
- **Una lectura nueva que necesite el máximo de otra columna** tiene que heredarlo igual, en `character_activity` y desde el archivado, o leer el índice de rating de Storage. Volver a conservar filas por eso es volver a pagar lo que esto quita.
