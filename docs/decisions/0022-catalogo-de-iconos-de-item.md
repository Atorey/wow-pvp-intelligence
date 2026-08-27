# ADR 0022 — El icono es un catálogo con fecha de revisión, no una columna del snapshot

**Fecha**: 27 de agosto de 2026 · **Estado**: aceptada (issue [#67](https://github.com/Atorey/wow-pvp-intelligence/issues/67); ejecuta la decisión 7 del [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md)) · **Desbloquea [#22](https://github.com/Atorey/wow-pvp-intelligence/issues/22) y [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17)**. Lo que se ve cuando no hay icono ya está decidido en la [§4.5 del brief](../design/brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono)

## Contexto

`character_snapshot_gear` ([migración 0002](../../db/migrations/0002_profile_snapshots.sql)) guarda `item_id`, `item_name`, `item_level`, calidad, gemas y encantamientos. No guarda icono. Y `aggregate_snapshots` arrastra `item_name` con el comentario _"nombre legible en el momento del cálculo, para pintar sin resolver ids"_, que es media verdad: el nombre sí se puede pintar sin resolver nada, la imagen no.

El [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) ya cerró la mitad del espacio de opciones de este issue: **el origen es la Media API de Blizzard y no un tercero**, y **lo que se guarda es el mapeo `item_id → url`, nunca el archivo**. Lo que quedaba por decidir —y es lo que decide este ADR— es dónde vive ese mapeo, cuánto vale antes de volver a preguntarlo, qué se cataloga, y a costa de qué cuota.

Hay tres hechos medidos que condicionan las respuestas.

**El icono se pide por item y cuesta una petición.** `/data/wow/media/item/{id}` en namespace `static` devuelve una lista de assets, y el de clave `icon` trae la URL completa del CDN:

```
GET /data/wow/media/item/249979?namespace=static-eu
{"assets":[{"key":"icon","value":"https://render.worldofwarcraft.com/eu/icons/56/7384535.jpg","file_data_id":7384535}],"id":249979}
```

Un item que no existe responde 404. No hay endpoint por lotes: el catálogo se paga item a item, una vez.

**Gemas e items son la misma cosa; los encantamientos, no.** Contado sobre los 607 perfiles capturados en `data/profiles`, con 4.179 encantamientos observados:

| Qué                                  | Vía de icono                             | Distintos | Ocurrencias |
| ------------------------------------ | ---------------------------------------- | --------- | ----------- |
| Item equipado                        | `media.id` → `/data/wow/media/item/{id}` | —         | 100%        |
| Gema                                 | `sockets[].media.id`, el mismo endpoint  | —         | 100%        |
| Encantamiento con `source_item`      | el item origen, el mismo endpoint        | 18 de 92  | 13,6%       |
| Encantamiento con `spell`            | `/data/wow/media/spell/{id}`             | 1 de 92   | 0,2%        |
| Encantamiento sin ninguna de las dos | ninguna en la Game Data API              | 73 de 92  | **86,2%**   |

Una gema es un item con su `item_id` y su icono, y `character_snapshot_gear.gem_item_ids` ya lo guarda. Un encantamiento no: la mayoría solo trae `enchantment_id` y un `display_string`, y la Game Data API no publica ninguna ruta de media para un `enchantment_id`. Además, de la minoría que sí sería resoluble, hoy **tiramos el dato al mapear**: [profile-mapping.ts](../../apps/pipeline/src/jobs/profile-mapping.ts) se queda con `enchantment_id` y descarta `source_item.id` y `spell.id`.

**La cláusula 2.s no distingue entre dato de jugador y dato de juego.** Dice _"You must implement a maximum 30-day TTL (time-to-live) policy for all Data obtained through our APIs"_. La salida que da a los desarrolladores de WoW es revalidar que un **personaje** sigue existiendo, y no hay ninguna equivalente para un item.

## Decisión

1. **El mapeo vive en una tabla propia, `item_media`, no en una columna de gear.** Una fila por `item_id`, con `icon_url` y `resolved_at` ([migración 0009](../../db/migrations/0009_item_media.sql)). Guardarlo en `character_snapshot_gear` repetiría la misma URL una vez por personaje y por snapshot, y ataría un hecho del juego a una observación de alguien.

2. **`item_media` no es append-only, y eso no toca la regla 1.** Aquí se hace `update`: revalidar es exactamente pisar la fila con la respuesta de hoy. Lo que el [ADR 0002](0002-modelo-append-only.md) protege es la observación de un personaje en un instante —reescribir su rating destruye el histórico que es el moat—, y el icono de un item no es la observación de nadie.

3. **Una fila vale 30 días.** No porque el icono cambie, que no cambia, sino porque la 2.s obliga a refrescar todo Data en ese plazo y este mapeo es Data. Elegir la lectura cómoda —"la 2.s va del dato de jugador, que es de quien habla su justificación"— sería interpretar a nuestro favor un texto que no excluye lo estático, y costaría poco: el catálogo son cientos o miles de filas, no cientos de miles, y la revalidación se reparte a lo largo del mes.

4. **Se catalogan los items de equipo y sus gemas.** Salen de la misma consulta y del mismo endpoint porque son la misma clase de cosa.

5. **Los encantamientos quedan fuera, y queda escrito por qué.** No es un recorte de alcance por tiempo: el 86% de los observados no tiene ninguna vía en la API de Blizzard, y la única fuente para ellos sería una base de datos de terceros, que es lo que el [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) descarta por servir el mismo Material sin más derecho que nosotros. El 14% restante exigiría además una columna nueva en `character_snapshot_gear` y un cambio de mapeo **que no se puede rellenar hacia atrás**, porque el histórico es append-only. Queda en [#92](https://github.com/Atorey/wow-pvp-intelligence/issues/92) con estos números delante.

6. **Se resuelve con un job del pipeline, nunca desde la web.** `resolve-item-media` toma los `item_id` observados que no tienen fila o la tienen caducada, y los pide por `BlizzardClient` con prioridad `aggregate`. Es la regla 4 y es el [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md): la web no tiene cuota propia y nadie espera delante de un icono.

7. **Una respuesta se recuerda; un fallo, no.** Un 200 sin asset de icono y un 404 escriben la fila con `icon_url = null`, que es "preguntado y no hay". Un 500 o una caída de red no escriben nada y el item vuelve a estar pendiente. La ausencia de fila significa "todavía sin preguntar", y es la tercera cosa distinta.

8. **El presupuesto es un flag, no una variable de entorno.** `--budget`, con 3.000 peticiones por defecto y los nunca preguntados por delante de los que solo hay que revalidar.

9. **La lectura expone `iconUrl` y el join es `left`.** `readAdoption` de [`packages/data`](../../packages/data/src/segments.ts) junta `item_media` por `item_id` y devuelve `null` cuando no hay. Nunca `inner`: un item sin icono resuelto sigue siendo una adopción que hay que enseñar, y filtrar por el catálogo escondería cifras reales por un fallo de ilustración.

10. **El dataset de desarrollo trae los iconos resueltos en el JSON.** Los 204 items de `seed-items.eu.json` llevan su URL, resuelta una vez contra la API y commiteada, y `seed` los siembra en `item_media`. El comando sigue sin llamar a Blizzard, que es lo que le exige el [ADR 0018](0018-dataset-de-desarrollo.md).

## Por qué

**Porque un icono ausente no es un error, y el diseño ya lo había decidido antes que la infraestructura.** La [§4.5 del brief](../design/brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono) fija que la fila de gear no depende del icono: hueco reservado, sin texto de error ni _placeholder_. Esa decisión es la que permite que todo lo de aquí sea barato. Si la pantalla necesitara el icono para tener sentido, el catálogo sería una dependencia dura —habría que resolverlo antes de publicar nada, y un 403 del CDN sería un incidente—. Como no lo necesita, el catálogo puede llenarse a su ritmo, con presupuesto, en prioridad `aggregate`, y quedarse a medias sin que ninguna página se rompa.

**Porque distinguir "no hay" de "no lo he preguntado" es lo que hace que el job termine.** Es la misma distinción de la regla 5 aplicada a otra cosa. Sin ella, cada corrida vuelve a preguntar por los items que la API no resuelve, y esos no desaparecen: se acumulan. Con un catálogo de miles de items eso es media corrida gastada en volver a recibir el mismo 404. Y la simétrica importa igual de poco y de mucho: apuntar un 500 como "sin icono" convierte un problema de un minuto en un hueco de treinta días en todas las páginas que lleven ese item.

**Porque el TTL barato hoy es el que no hay que defender mañana.** La lectura alternativa de la 2.s es razonable —su justificación explícita es el derecho de retirada del jugador, que no le aplica a una espada— y aun así se descarta. La cláusula dice _"all Data"_, la excepción que Blizzard escribió para WoW es sobre personajes, y el coste de tomarla al pie de la letra es un job que ya existe corriendo sobre unas pocas filas más al mes. Cuando el precio de cumplir la letra es ese, interpretar sale caro y no ahorra nada.

**Porque razonar por analogía con `item_name` es justo lo que el ADR 0015 avisó de que no funciona.** El nombre llega por la API y es Data; el PNG vive en un sitio web de Blizzard y es Material bajo licencia de uso personal. Por eso el catálogo guarda una URL y no un archivo, y por eso no hay caché de imágenes en nuestro dominio ni la habrá: no es una decisión de infraestructura que se pueda revisar por rendimiento.

**Porque los encantamientos son el sitio donde este issue se habría ido de las manos sin darse cuenta.** "Iconos para las páginas de gear" suena a una sola cosa. Medido, son tres: items y gemas se resuelven con el mismo endpoint y salen enteros; los encantamientos no tienen endpoint para el 86% de los casos, y el 14% que lo tendría exige tocar el schema del histórico para un dato que no se puede recuperar hacia atrás. Meter eso aquí habría metido una migración de `character_snapshot_gear` dentro de un issue de infraestructura de iconos, con la mayoría de las filas históricas condenadas a no tener icono igualmente. Se separa con los números escritos para que la decisión se tome mirándolos.

## Consecuencias

- **[#22](https://github.com/Atorey/wow-pvp-intelligence/issues/22) recibe `iconUrl` en cada fila de adopción de gear**, con `null` como estado normal y no como fallo. Lo que tiene que construir es el `GearRow` de la [§5 de system.md](../design/system.md#5-componentes) con el hueco reservado; el dato ya está.
- **[#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) hereda lo mismo** para el gear del perfil, cuando lea de Postgres.
- **Aparece un job más en la cadencia diaria.** `resolve-item-media` compite en el presupuesto del [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md) con prioridad `aggregate`, igual que `refresh-profiles`. La primera corrida es la cara —paga el catálogo entero— y a partir de ahí solo quedan los items nuevos de cada parche y la revalidación repartida.
- **[#92](https://github.com/Atorey/wow-pvp-intelligence/issues/92) queda abierto por los encantamientos**, con el reparto medido de arriba: si se decide hacerlo, arrastra columna nueva en `character_snapshot_gear`, cambio en `profile-mapping` y la aceptación de que el histórico anterior no se puede rellenar.
- **La web tendrá que permitir `render.worldofwarcraft.com` como origen de imágenes** cuando pinte la primera fila de gear: los `remotePatterns` de Next y, si acaba habiéndola, la CSP. No se hace aquí porque hoy no hay ninguna página que lea gear.
- **El [ADR 0018](0018-dataset-de-desarrollo.md) gana un artefacto que mantener**: las URL commiteadas en `seed-items.eu.json`. Envejecen como el resto del catálogo —son de la temporada 41— y se refrescan volviéndolas a resolver cuando se refresque el catálogo, no a mano.
- **La URL del CDN lleva la región dentro** (`/eu/icons/…`), y el catálogo está keyed solo por `item_id`. Mientras el producto sea EU no cambia nada; el día que haya multi-región —marcado V3/Never en §26 del plan— habrá que decidir si la clave crece o si la región se sustituye en la URL, y esa es una decisión con ADR propio.
