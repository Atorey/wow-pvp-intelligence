# ADR 0027 — El gear se agrega por item, por gema y por encantamiento

**Fecha**: 4 de septiembre de 2026 · **Estado**: aceptada (issue #22; amplía otra vez el conjunto cerrado de variables del [ADR 0007](0007-agregados-por-segmento.md) y reencuadra #92 sin cerrarla)

## Contexto

§16 del plan pide "ítems/trinkets/**gemas/encantamientos** más usados, segmentados por rango de rating y spec", y decide como Core MVP el _adoption rate de gear por segmento, que alimenta directamente Player Gap_.

De las cuatro cosas que nombra, hasta hoy se agregaba una. El item por grupo de slot está publicado de punta a punta desde #15, #66 y #67 —`aggregateGearItems()`, la escritura en `aggregate_snapshots`, `readAdoption()` con su icono—, pero `gem_item_ids` y `enchantment_ids` llevaban guardándose desde la migración 0002 sin que nadie los leyera. Se estaban tirando, igual que se tiraban los nodos de talento antes del [ADR 0026](0026-talentos-por-nodo.md).

Y quedaba un hueco más, este de forma: `biggestGearDifferences()` compara dos escalones pidiendo las **poblaciones enteras**, un `PlayerBuild[]` por segmento reconstruido desde `character_snapshots`. Eso lo puede hacer el pipeline y no lo puede hacer la web, que lee filas agregadas ([ADR 0014](0014-capa-de-lectura-compartida.md)). Sin una comparación que trabaje sobre agregados, el `adoption_rate` publicado por segmento no alimentaba a nadie.

### Lo medido

Sobre los 607 perfiles cacheados de `data/profiles/run-20260814T121556/` —593 con equipo, 9.775 items—, sin gastar una sola petición:

| Variable                          | Distintas por ~100 perfiles de un segmento | Nombre disponible                                                  |
| --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `talent_loadout_code` (rechazado) | 85-97                                      | —                                                                  |
| **Gemas**                         | 29-39                                      | **100%** de las que llegan (2.511/2.511, en `sockets[].item.name`) |
| **Encantamientos**                | 48-57                                      | **100%** de las 4.179 entradas, en `enchantments[].display_string` |

Los 268 huecos restantes son sockets sin engemar, que es una observación y no una ausencia. La dispersión es la mitad de la de los códigos de loadout, y esa es toda la diferencia entre describir un escalón y describir a siete personas. Aguanta al crecer la población: sobre las 232.735 filas de gear que hay hoy en producción —49.994 con gema y 85.756 con encantamiento— son **107 gemas y 128 encantamientos distintos** en toda la temporada.

Y las dos discriminan, con el mismo `MIN_DISCRIMINATIVE_DELTA` de 10 puntos:

```
Frost Mage        1800-2000 -> 2000-2200 (n=99/98)
  [ench] Enchant Ring - Silvermoon's Alacrity      5% -> 21%
  [ench] Enchant Boots - Farstrider's Hunt        44% -> 57%
  [gem]  Flawless Versatile Peridot                9% -> 20%
Fury Warrior      1800-2000 -> 2000-2200 (n=100/97)
  [gem]  Indecipherable Eversong Diamond          15% -> 28%
  [ench] Enchant Helm - Empowered Hex of Leeching  9% -> 22%
```

### Lo que esto le hace a #92

El [ADR 0022](0022-catalogo-de-iconos-de-item.md) dejó los encantamientos fuera del catálogo de iconos con los números delante: de 4.179 observados, el 86,4% solo trae `enchantment_id` y la Game Data API no publica media para eso. Ese número se ha vuelto a medir aquí y es el mismo.

Lo que no se había mirado es que **lo que faltaba era el icono, no el nombre**. El `display_string` llega en el 100% de las entradas, y §4.5 del brief ya dice que el nombre y el item level son la información y que el icono solo acompaña, con el hueco reservado y `null` como estado normal. Un encantamiento agregado se pinta exactamente como un item cuyo icono todavía no se ha resuelto.

#92 sigue abierta y sigue siendo lo que era: si el 14% resoluble merece el cambio de schema para tener iconos de encantamiento.

## Decisión

1. **Tres variables de gear, no una**: `gear-item`, `gear-gem` y `gear-enchant`. El conjunto de `AggregateVariableKind` sigue cerrado —añadir una es tocar el tipo y el `check` de la migración—, pero pasa de cinco a siete. Stats secundarias y embellishments siguen fuera porque el schema no las guarda.

2. **Un solo denominador para las tres: `gear_sample`.** Al contrario que los nodos de talento, aquí no divergen: gemas y encantamientos salen de la misma fila de `character_snapshot_gear` que el item, con `not null default '{}'` desde la 0002. Si leímos su equipo, leímos sus gemas. No hay columna nueva en `population_segments`.

   El corolario importa: **un equipo sin gemas cuenta dentro del denominador con adopción 0**. No engemar es un hecho observado. Es el caso simétrico de la regla 5, y confundirlo con "no disponible" sacaría del denominador justo a la gente que la variable describe.

3. **Ni la gema ni el encantamiento se agrupan por slot.** La misma gema se engarza en piezas distintas y la pregunta que responde su `adoption_rate` es "¿la lleva?", no "¿en qué hueco?". Agruparlas por slot partiría en dos la adopción de un encantamiento de anillo entre `FINGER_1` y `FINGER_2`, que es literalmente el artefacto que §6.3 de findings corrigió con los abalorios.

4. **La gema rellena `item_id`; el encantamiento tiene columnas propias.** Una gema es un item, así que hereda gratis el catálogo de iconos —`resolve-item-media` ya resolvía gemas, su CTE une `item_id` con `unnest(gem_item_ids)`— y el `left join` de `readAdoption`. Un encantamiento no lo es, y **no es purismo**: la lectura junta `item_media` por `item_id`, así que un `enchantment_id` guardado ahí cruzaría con el item que compartiera ese número y la fila saldría con el icono de otra cosa. Par propio, `enchantment_id` / `enchantment_name`, por la misma razón por la que la 0012 se lo dio a los talentos en vez de inventar un `variable_label` común.

5. **El nombre se guarda con la observación, no se resuelve después.** Dos arrays paralelos por posición a los de ids, construidos en la misma pasada de `mapEquipment` — que es lo que garantiza que no se desalineen cuando un socket viene vacío. La alternativa era un catálogo por id, y no existe: la Media API devuelve assets, no nombres, y un encantamiento no tiene endpoint de item al que preguntar.

6. **Sin backfill, y sin necesitarlo.** Los ids llevan guardados desde la 0002, así que el `adoption_rate` es correcto desde el primer recálculo. Lo que empieza en la migración 0013 es la **etiqueta**, que hasta entonces sale a `null` —"no disponible", no "sin nombre"— y se rellena sola según `refresh-profiles` vuelve a pasar. Es lo contrario del caso de los nodos, donde faltaba el dato entero.

7. **La comparación entre escalones se calcula sobre agregados y vive en core.** `biggestDifferences(own, target)` recibe variables ya agregadas y devuelve las que superan `isDiscriminative()`, con las mismas reglas heredadas: candidatos los del segmento objetivo, orden estable, y la lista sale más corta antes que rellenarse. Hay un test que comprueba que da lo mismo que `biggestGearDifferences()` sobre las poblaciones, que es el mismo seguro que ya protege a `aggregateGearItems()` frente a `slotItemAdoption()`.

   Una variable que no aparece en el segmento propio es **adopción 0 sobre el denominador real de ese segmento**, no una ausencia: que nadie de 1800-2000 lleve un item es un dato.

8. **Player Gap sigue siendo de gear, y esto llega hasta el dato.** La caja del perfil sigue enseñando solo item level y las tres rutas de spec siguen en `PagePlaceholder`: levantar la lista de diferencias es #18 y la pantalla de spec es #99.

## Consecuencias

- **La migración 0013** añade `gem_item_names` y `enchantment_names` a `character_snapshot_gear`, `enchantment_id` y `enchantment_name` a `aggregate_snapshots`, y amplía el `check` a siete valores.
- **`PlayerBuild` gana `gems` y `enchantments`, y no son nullable.** La asimetría con `talents` es la decisión 2 hecha tipo: quien construya un `PlayerBuild` no puede expresar "no sé si lleva gemas" sin decir antes que no sabe qué lleva puesto.
- **`countSelections()` deja de ser de talentos** y cuenta las cuatro familias de selección. Era ya lo que hacía falta —una pasada, un `Set` por persona, el nombre que se queda con la primera aparición que lo traiga—, así que la alternativa era copiarlo dos veces.
- **`readAdoptionFor()`** lee varios escalones en una consulta, cada uno con la procedencia del suyo. Sigue recibiendo los `SegmentRead` y no sus ids (punto 8 del ADR 0014).
- **La gema hereda el catálogo de iconos, pero hoy está vacío de gemas.** Medido contra producción el 4 de septiembre de 2026: de las **107 gemas distintas** observadas, `item_media` no tiene fila de ninguna. `resolve-item-media` las contempla desde el [ADR 0022](0022-catalogo-de-iconos-de-item.md) —su CTE une `item_id` con `unnest(gem_item_ids)`— pero su presupuesto se va antes en los items equipados. Así que las primeras filas `gear-gem` saldrán con `iconUrl` a `null`, que es el estado normal de §4.5 y no un fallo; se irán llenando según el job vaya alcanzando el catálogo.
- **El seed siembra gemas y encantamientos con los `base`/`drift` medidos**, para que la lista de diferencias en local enseñe lo mismo que enseñaría en producción. Ninguna se siembra en `item_media`: en local salen sin icono, que es el estado que hay que saber pintar.
- **Sirve desde el primer recálculo, en los mismos pares que el item.** La última corrida tiene **64 pares `(spec, segmento)` con `gear_sample >= 30`**, y son exactamente los que ya publican adopción de item: las tres variables comparten denominador, así que ninguna añade ni quita cobertura.
- **Sube el volumen de `aggregate_snapshots`**: unas 40 filas más por segmento. Es una decisión de retención (#48), no de agregación, y el punto 7 del ADR 0007 sigue mandando — se guarda hasta la gema que lleva una sola persona, porque el poder discriminante de §13.3 se calcula justo con las adopciones bajas.

## Alternativas descartadas

- **Dejar los encantamientos fuera, como hizo el ADR 0022.** Habría sido coherente con la decisión anterior y equivocado por la razón nueva: son la variable con **más** señal de las dos, y lo que les falta es la ilustración.
- **Un `variable_label` común para todas las familias.** Descartado ya por la 0012 y por lo mismo: dejaría `item_name` huérfano y haría más vagos los dos lados a cambio de una columna.
- **Agregar la gema por (slot, gema).** Multiplica las filas y parte la adopción de la misma gema entre las piezas donde cae, sin responder ninguna pregunta que alguien se haga.
- **Resolver los nombres en un catálogo aparte, como los iconos.** No hay de dónde: la Media API no devuelve nombres y el encantamiento no tiene endpoint propio. El nombre solo llega pegado a la observación.
