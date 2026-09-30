# ADR 0043 — La revalidación de 30 días borra de Postgres en el acto y de Storage en bloque

**Fecha**: 30 de septiembre de 2026 · **Estado**: aceptada (issue #134; implementa la decisión 2 del [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) y matiza el punto 5 del [ADR 0034](0034-historico-frio-archivado-en-storage.md))

## Contexto

La cláusula 2.s de la ToU de Blizzard no deja guardar ningún dato más de 30 días sin revalidarlo. Para WoW admite revalidar comprobando que el personaje sigue existiendo, y obliga a borrar al que no existe. El ADR 0015 lo fijó como decisión 2, y `/privacy` lo promete en las dos lenguas. Nada de eso estaba implementado.

Medido en producción el 30 de septiembre de 2026:

- **172.110 personajes, y unos 79.000 llevan más de 30 días sin prueba de existencia.** Casi todos son de la temporada 41, cuya presencia y cuyos snapshots ya salieron de Postgres ([ADR 0042](0042-una-temporada-cerrada-sale-de-postgres.md)). Hoy la promesa ya se incumple.
- Unos 87.000 tienen prueba de los últimos cinco días, casi todos por el leaderboard.
- El archivo de Storage son 76 lotes con la población entera dentro, más los ficheros de la temporada 41 y el índice de rating.

Blizzard documenta el uso del endpoint de estado (`/profile/wow/character/{realm}/{name}/status`) con tres motivos de borrado: un 404, un `is_valid` falso, o un id distinto del que se guardó.

## Decisión

1. **`characters.verified_at` es la última prueba de existencia, y se guarda.** No se deriva al leer porque ya no se puede: de quien solo jugó una temporada cerrada no queda en Postgres más que su fila de `characters`. La mueven todas las fuentes que acaban de oír a Blizzard hablar del personaje: la ingesta del leaderboard, con la hora de la publicación, la de perfiles, la búsqueda y el barrido. La ingesta ya reescribía la fila en cada upsert, así que anotarla no cuesta nada. No lleva índice, por la misma razón: rompería las actualizaciones HOT de la tabla que más se reescribe, y la leen dos jobs una vez al día.
2. **Un barrido diario, `revalidate-characters`**, pregunta al endpoint de estado por quien lleva **18 días** sin prueba, de los más antiguos a los más nuevos. Va por `BlizzardClient` como `batch` y con un tope de 20.000 peticiones por corrida (`REVALIDATION_BUDGET`).
3. **Qué es «ya no existe»**:
   - un 200 con `is_valid: true` y el mismo id es prueba de existencia;
   - `is_valid: false` o un id distinto se borran a la primera: Blizzard lo ha dicho explícitamente;
   - un **404 se anota en `missing_since` y solo borra si se repite al menos 20 horas después**, sin ninguna prueba entre medias;
   - cualquier otra cosa es «no se pudo mirar», que no es «no existe», la misma distinción que `character_lookups.outcome`.
4. **Un cambio de nombre o de reino es un borrado**, salvo que el leaderboard lo vea antes. Si sale en una publicación con su nombre nuevo, la ingesta mueve la fila por id ([ADR 0017](0017-forma-canonica-de-personaje.md)), el histórico se conserva y el barrido no llega a preguntar. Si no, el nombre viejo da 404 y no hay forma de encontrar el nuevo: la API no busca por id. Es lo que pide Blizzard.
5. **Un nombre reciclado no hereda nada.** Si la ingesta o la búsqueda traen un nombre que ya teníamos con otro id de Blizzard, la fila vieja se borra antes del upsert. Hasta ahora el upsert le ponía el id nuevo a la fila vieja y el recién llegado se quedaba con el histórico de otro. El personaje borrado que vuelve con su mismo nombre y otro id es, para nosotros, alguien nuevo: fila nueva, uuid nuevo, nada en Postgres ni en Storage que lo apunte.
6. **En Postgres se borra en el acto**, en la transacción de quien lo descubre (`eraseCharacters`). El `on delete cascade` se lleva snapshots, gear, talentos, presencia y actividad. `character_lookups` conserva reino y nombre en claro con `on delete set null`, así que sus filas se borran a mano: las del personaje y las que buscaron su nombre. Su id interno queda en `character_erasures`, y nada más, porque es lo único con lo que se le encuentra en el archivo.
7. **En Storage se borra en bloque, con `purge-archive`**, detrás del archivado. Espera a que algún borrado pendiente tenga su última prueba a 22 días y entonces quita a todos los pendientes de una vez: de los lotes, de los ficheros de actividad y presencia de las temporadas cerradas y del índice de rating. Encontrarlos obliga a bajar los lotes, y hacerlo una vez cada pocos días con todos cuesta lo mismo que hacerlo cada día con uno.
8. **El archivo sigue sin sobrescribirse.** Un lote afectado se escribe filtrado en una ruta nueva (`<lote>.p<corrida>`), la bitácora pasa a apuntar a ella y la vieja se borra. Entre esos pasos cabe un corte, y lo cubre un diario, `archive_garbage`. Quien va a subir anota antes la ruta, y la desanota en la misma transacción que la apunta desde la bitácora; lo que queda anotado no lo lee nadie y la corrida siguiente lo borra. El archivado de snapshots y el de temporadas cerradas usan el mismo diario, así que un lote subido de una corrida cortada ya no queda huérfano: se borra. El índice de rating se reescribe en su sitio, como siempre ([ADR 0039](0039-el-historico-de-rating-se-lee-de-un-indice-en-storage.md), punto 4).
9. **Un candado de sesión en Postgres serializa a quien escribe en el bucket**: `archive-snapshots`, `purge-archive` y `backfill-rating-history`. El diario solo es seguro con un escritor: una ruta anotada puede ser una subida a punto de confirmarse. Y el archivado bloquea con `for key share` a los personajes del lote mientras lo sube, de modo que un borrado que se cruce espere y encuentre al personaje ya en un lote que la purga recorrerá.
10. **`check-freshness` falla si alguien pasa de 30 días sin prueba, o si un borrado sigue en Storage 30 días después de su última prueba.** Es el aviso de que la promesa de `/privacy` ha dejado de cumplirse.

La cadena de plazos, en el peor caso: el día 18 el barrido pregunta y anota el 404, el día 19 lo confirma y borra de Postgres, y el día 22 la purga lo saca de Storage. Quedan ocho días de margen para una corrida perdida.

## Por qué no las alternativas

- **Derivar la última prueba de `character_presence`, los snapshots y la bitácora de búsquedas.** Era lo natural antes del ADR 0042. Desde entonces, de la temporada cerrada no queda nada de eso en Postgres, y precisamente sus personajes son los que hay que revalidar.
- **Borrar al primer 404.** Es la lectura literal, y un borrado no tiene vuelta atrás. Un 404 masivo por una caída de Blizzard durante el barrido se llevaría miles de históricos que siguen siendo de alguien. La segunda comprobación retrasa un día un borrado y no añade ningún riesgo de incumplir el plazo.
- **Purgar Storage en el acto, personaje a personaje.** Cada borrado obligaría a bajar y reescribir todos los lotes donde aparece, que son casi todos los de sus días de actividad.
- **Lista negra al leer, sin tocar el archivo.** El dato seguiría guardado, y lo que la ToU pide es borrarlo, no dejar de enseñarlo.
- **Soltar el id del personaje viejo en un nombre reciclado**, como hacía el paso 0b. Deja el histórico colgado de un nombre que ya es de otro, y Blizzard pide borrar cuando el id no coincide.
- **Cifrar por personaje y borrar la clave.** Resuelve el borrado sin reescribir, pero el archivo ya existe en claro, y la web no lee lotes: la complejidad no compra nada aquí.

## Consecuencias

- **La primera semana el vigilante falla.** Hay unos 79.000 personajes fuera de plazo, y a 20.000 por noche el barrido tarda cuatro días en ponerse al día. Es el comportamiento correcto: la promesa se incumple hasta entonces, y el correo lo dice. Para acortarlo se puede subir `REVALIDATION_BUDGET`, o lanzar una corrida a mano con `--budget`. En régimen, la cifra ronda los 5.000 al día: quien no sale en el leaderboard, una vez cada 18 días.
- **La migración 0025 reescribe `characters` entera** (55 MB, 172.110 filas) para rellenar `verified_at`. Conviene ensayarla con `migrate --rehearse` y pasar `compact` a esa tabla después.
- **Las primeras purgas bajan el archivo entero** mientras se vacía el atasco. Imprimen lo leído y lo escrito, y esa es la cifra buena de egress: no se pudo medir el tamaño del bucket desde aquí.
- **Un personaje renombrado que no vuelve a salir en el leaderboard pierde su histórico.** Es lo que pide Blizzard, y no hay forma de encontrarle.
- **Dos personajes que se intercambian el nombre** entre dos ingestas pierden los dos su histórico: el paso 5 no puede distinguirlo de dos reciclados y se queda en el lado seguro.
- **Lo que no identifica a nadie no se toca.** `gear_pieces` y `talent_sets` son contenido del juego compartido: una pieza no dice de quién era. Los agregados se recalculan cada día, y el borrado sale de la población en la corrida siguiente.
- **La retirada a petición del jugador**, que `/privacy` también ofrece, tiene ya el mecanismo (`eraseCharacters`) y no tiene ni comando ni lista de exclusión. Un personaje retirado que siguiera en el leaderboard volvería a entrar en la siguiente publicación. Queda para cuando haya dirección de contacto publicada.
