# ADR 0026 — Los talentos se observan por nodo, no por código de loadout

**Fecha**: 4 de septiembre de 2026 · **Estado**: aceptada (issue #21; amplía el conjunto cerrado de variables del [ADR 0007](0007-agregados-por-segmento.md) y deja sin objeto a #24)

## Contexto

§15 del plan pide "la build más popular por spec, segmentada por rango de rating". Hasta hoy la única representación de una build en toda la base era una columna `text`: el `talent_loadout_code` completo, agregado por coincidencia exacta.

Eso no agrupa nada, y ya no es una sospecha. Medido contra producción el 4 de septiembre de 2026, con la población que trajo #66 detrás:

|                                                           |                   |
| --------------------------------------------------------- | ----------------- |
| Códigos distintos en segmentos con `talent_sample = 100`  | entre **75 y 97** |
| Pares `(spec, segmento)` con `talent_sample >= 30`        | 140               |
| De esos, con la build más repetida **por debajo del 10%** | **101**           |
| Por encima del 30%                                        | 4                 |

Es el hallazgo de [§6.2 de findings](../sprint-0-findings.md) confirmado con muestra real. Por eso el [brief](../design/brief.md) prohíbe pintar el top-3 de códigos —"un «el 7% de 2000-2200 usa esta build» describe a siete personas, no a un segmento"— y por eso §8.2 de findings decidió lanzar sin la categoría Talents.

Esa decisión se apoyaba en dos razones. La segunda —la comparación exacta no informa— sigue en pie. **La primera era falsa**: daba por hecho que decodificar el loadout (#24) era "parsear el árbol de talentos de cada spec contra un formato que Blizzard no documenta como API", investigación de duración desconocida que no podía ir en el camino crítico.

No hace falta parsear nada. La respuesta de `/specializations` que `refresh-profiles` ya descarga —y que ya se abre para sacar el código— trae los nodos decodificados por Blizzard en el mismo objeto `loadout`. Verificado sobre los 594 perfiles cacheados de `data/profiles/run-20260814T121556/`:

| Campo                       | Contenido                                      | Presencia                                             |
| --------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| `selected_class_talents`    | ~38 nodos con `id`, `rank` y nombre en tooltip | 100% de los loadouts, también los de specs no activas |
| `selected_spec_talents`     | ~32 nodos                                      | ídem                                                  |
| `selected_hero_talents`     | ~14 nodos                                      | ídem                                                  |
| `selected_hero_talent_tree` | `{id, name}`: la elección de árbol de héroe    | 92% de los loadouts                                   |
| `pvp_talent_slots`          | los 3 talentos PvP, con `id` y nombre          | 88% de las entradas de spec                           |

Estábamos tirando el dato: `SpecializationsResponse` modelaba únicamente `talent_loadout_code`.

Y por nodo hay señal discriminante, que es lo que el código exacto no daba. Prototipado sobre esos mismos perfiles, partiendo por segmento de rating, todo por encima de `MIN_DISCRIMINATIVE_DELTA`:

```
Frost Mage · 1800-2000 -> 2000-2200 (n=99/98)
  Frozen Touch            62% -> 80%   (+18pp)
  PvP: Master Shepherd    49% -> 65%   (+16pp)
  Shimmer                 51% -> 37%   (-14pp)
  Improved Blink          49% -> 62%   (+13pp)

Restoration Shaman · 1800-2000 -> 2000-2200 (n=99/99)
  PvP: Static Field Totem 47% -> 30%   (-17pp)
  Refreshing Waters       44% -> 61%   (+16pp)
  PvP: Lightning Lasso    48% -> 60%   (+11pp)
```

## Decisión

1. **La variable agregada es el nodo, no la build.** Cada nodo de clase, de spec y de héroe es una variable con su `adoption_rate` por segmento, exactamente igual que un `item_id` en gear. El producto describe qué lleva el escalón de arriba; no publica "la build del segmento", que es justamente lo que la cardinalidad desmiente.
2. **El árbol de héroe y los talentos PvP son variables aparte**, no nodos. El árbol es una elección única del loadout (`hero-tree`); los talentos PvP cuelgan de la spec y no del loadout (`pvp-talent`).
3. **`talent-code` se conserva.** Deja de ser la única lectura de talentos, pero el reparto de códigos es en sí el dato que mide esa división, y su histórico arranca en agosto de 2026.
4. **Tres denominadores, no uno**: `talent_sample` (tiene código), `talent_node_sample` (tiene nodos) y `pvp_talent_sample` (tiene talentos PvP), en la [migración 0012](../../db/migrations/0012_talent_nodes.sql).
5. **Los nodos salen del mismo loadout que el código.** `findTalentLoadout` devuelve las dos cosas a la vez; no hay una segunda función que vuelva a elegir loadout.
6. **El `rank` se guarda y no se agrega.** La variable es "lleva Frozen Touch"; que lo lleve a 1 o a 2 puntos es señal adicional que no entra todavía.
7. **Sin backfill.** Los snapshots ya guardados conservan su código y nada más.
8. **Player Gap sigue siendo de gear.** Esto entrega el dato agregado y legible; levantar la categoría Talents de la caja es #18, y la pantalla de spec es #99.

## Por qué

**Por qué el nodo y no la build.** La diferencia entre §15 y §16 del plan no es de intención sino de precisión: §16 nombra la unidad de agregación —ítem, gema, encantamiento— y §15 dice "la build" como si fuera una entidad. En gear la variable atómica es natural y compartida entre jugadores; en talentos nunca se definió, y la implementación heredó el hueco usando el código completo. El nodo es a los talentos lo que el `item_id` es al gear: la unidad que dos jugadores pueden compartir. Con el código completo no la comparten casi nunca, y por eso el porcentaje describe personas en vez de segmentos.

Esto además no rediseña nada. El [brief](../design/brief.md) ya lo dejó reservado —"cuando los talentos se decodifiquen en nodos, cada nodo es una variable más de la misma lista, con la misma fila. No hay que rediseñar la caja para meterlos"— y §13.2 del plan lo asumía desde el principio: "para cada variable comparable (**talento individual**, item, gema, encantamiento…)". Lo raro era lo que había, no lo que se hace ahora.

**Por qué tres denominadores y no uno.** Es la advertencia del [ADR 0007](0007-agregados-por-segmento.md) —"la mentira más fácil de contar con estos datos"— aplicada otra vez, y aquí no es teórica: durante los primeros días tras esta migración habrá segmentos con `talent_sample = 100` y `talent_node_sample = 0`, porque el código está guardado desde agosto y los nodos empiezan hoy. Y la API omite los `pvp_talent_slots` en ~12% de las entradas de spec, un "no disponible" que no tiene nada que ver con el del loadout. Un solo denominador convertiría tres cosas que divergen en un número que no describe a ninguna.

**Por qué del mismo loadout.** `findTalentLoadout` ya resuelve una regla que no se adivina: se coge el loadout de la spec **del bracket muestreado**, no el activo, porque un Frost Mage del leaderboard puede estar hoy en Fire. Si los nodos los eligiera una función distinta, tarde o temprano el código y los nodos de la misma fila describirían loadouts distintos, y nadie lo notaría porque los dos serían individualmente correctos.

**Por qué los talentos PvP entran, siendo otra cosa.** Porque son la elección de menor cardinalidad y mayor señal que tiene el juego en PvP —tres huecos de un catálogo corto— y porque están disponibles también para specs que el personaje no lleva activas, a diferencia del gear. Su `slot_number` no se guarda: la adopción es "lleva este talento PvP", y el hueco no forma parte de su identidad, la misma razón por la que `slot_group` normaliza `TRINKET_1`/`TRINKET_2`.

**Por qué sin backfill.** Recuperar los nodos de los códigos ya guardados exigiría escribir justamente el parser que este hallazgo permite evitar. Y no haría falta para el cálculo: los agregados se computan sobre el **último** perfil de cada personaje, no sobre el histórico. Con `refresh-profiles` trayendo ~1.300 perfiles al día sobre 11.938 personajes con perfil, la cobertura por nodo alcanza a la del código en unos diez días. Lo único que no se recupera es el histórico de builds anterior a hoy, y ese histórico —por código exacto— no describía nada.

**Por qué ahora y no cuando lo pida #18.** Por la misma razón por la que #66 arrancó en la ola 2 aunque su consumidor tardara semanas: acumular no se puede acelerar después. Si esto espera a que la caja Player Gap lo necesite, el día que lo necesite el denominador seguirá siendo cero.

## Consecuencias

- **`talent_node_sample` arranca en 0 y tarda ~10 días** en alcanzar la cobertura que hoy tiene `talent_sample`. Durante ese tiempo un consumidor tiene que declarar la ausencia como ya hace con el gear; `canShowComparison()` sobre el denominador correcto lo hace solo, y por eso las procedencias van separadas en `packages/data` ([ADR 0014](0014-capa-de-lectura-compartida.md)).
- **`AggregateVariableKind` deja de ser un conjunto cerrado de dos.** Pasa a cinco, y sigue siendo cerrado: añadir uno es tocar el tipo y el check de la migración, no meter cualquier cosa en un cajón genérico. Stats secundarias y embellishments siguen fuera porque el schema no las guarda.
- **#24 queda sin objeto.** Lo que describía —decodificar el string contra el árbol de cada spec— nunca hizo falta. Se cierra citando este ADR, en vez de dejarlo como deuda pendiente que ya no existe.
- **La segunda razón de §8.2 de findings sigue siendo válida y la primera no.** Ese apartado no se reescribe hacia atrás: se anota que su premisa de coste era errónea, del mismo modo que el ADR 0007 anota sus puntos sustituidos.
- **Crece el volumen de `aggregate_snapshots`**: del orden de 80 variables de talento por segmento, frente a las que ya aporta el gear. Sigue sin filtro de adopción mínima, por la razón del punto 7 del ADR 0007 —el poder discriminante de §13.3 necesita las adopciones bajas—. Entra en el alcance de #48 como todo lo demás.
- **#74 gana dos denominadores más que vigilar.** La cobertura servible de un par `(spec, segmento)` ya no es una cifra sino tres, y se mueven a ritmos distintos.
- **La advertencia de talentos de `CLAUDE.md` cambia de naturaleza.** La de disponibilidad —"ausente tras el parche 11.2, validado sobre 3 clases de 13"— lleva tiempo caducada: hoy son 99,5–100% en las 13 clases sobre 13.051 snapshots de perfil. La que la sustituye no es sobre el dato sino sobre su base: los nodos empiezan a contar desde esta migración.
