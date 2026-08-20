# ADR 0008 — La actividad se deriva de la variación del contador de partidas, con la evidencia declarada en cada fila

**Fecha**: 19 de agosto de 2026 · **Estado**: aceptada (implementa §27, "Active Players"; issue #16) · **Sustituye al punto 5 del [ADR 0007](0007-agregados-por-segmento.md)**

## Contexto

§27 exige que **todo** cálculo de `AggregateSnapshot` filtre por `last_active_snapshot_date` dentro de una ventana de actividad: "un personaje que llegó a 2400 hace ocho meses y no ha vuelto a jugar no cuenta en el `AggregateSnapshot` del segmento 2200-2400 actual". Sin ese filtro, el agregado no describe el meta actual sino el archivo acumulado, y el producto entero —que es una comparación contra el segmento de arriba— compara contra gente que ya no juega.

Lo que existía antes de este ADR era la mitad del mecanismo: las ventanas de 7/14/30 días y la regla de elección de §13.4 (`ACTIVITY_WINDOWS`, `pickActivityWindow`), y una columna `activity_window_days` en cada fila de `population_segments`. Lo que faltaba era la fecha por la que filtrar. El ADR 0007 lo dejó dicho en voz alta: mientras #16 no existiera, "activo" significaba `captured_at` — **lo hemos vuelto a ver en el ladder**—, que no es lo mismo que haber jugado y que sobreestima justo el tramo alto, el que no cae del top 5.000 aunque su dueño lleve semanas sin entrar.

La API no ayuda: **no hay campo "last seen"** ([§30](../product-plan.md)). Lo único que se mueve cuando alguien juega es `season_match_statistics.played`, así que la actividad hay que derivarla comparando snapshots nuestros.

Al implementarlo aparecieron tres hechos medidos sobre los datos de EU que condicionan la decisión:

1. **El contador del perfil y el del leaderboard no cuentan lo mismo.** En los 595 personajes con las dos fuentes para el mismo bracket y el mismo rating, el perfil da un número **menor** en 595 de 595 casos (p. ej. 60 en leaderboard y 10 en perfil). Compararlos entre sí fabrica una bajada y, detrás, una subida falsa al volver el leaderboard: en la primera implementación eso daba 594 personajes "activos" que no habían jugado nada.
2. **El leaderboard de una temporada terminada se congela.** En los 647.950 pares de snapshots consecutivos de la temporada 41 recogidos entre el 13 y el 19 de agosto no hay **ni un solo** cambio de `matches_played` ni de `rating`. El ladder se republica cada ~3h con el mismo contenido.
3. **El histórico es de días, no de meses.** La temporada 42 arrancó el 19 de agosto de 2026: casi toda la población tiene una única observación, y ninguna tiene todavía dos publicaciones con juego real entre medias.

De 2 y 3 sale el problema de arranque: un filtro que exija haber visto subir el contador deja **la población en cero** hoy, y con ella todos los agregados.

## Decisión

1. **`last_active_snapshot_date` se deriva de la subida estricta del contador de partidas** entre dos observaciones nuestras del mismo personaje, bracket y temporada. La regla vive en [`packages/core/src/activity.ts`](../../packages/core/src/activity.ts) (`deriveActivity`, `isActiveWithin`), con tests, por la misma razón que el resto del dominio: la web de Phase 2 tiene que decidir "activo" igual que el pipeline.
2. **Solo se comparan contadores del mismo origen.** Cada observación viaja con su `counterSource` y el listón es por origen; `search` comparte el del perfil porque sale del mismo endpoint. Restar contadores de fuentes distintas no es un riesgo teórico, es el hallazgo 1 del contexto.
3. **Dos niveles de evidencia, declarados y contados**:
   - `played-delta` — le hemos visto subir el contador: sabemos que jugó y cuándo.
   - `first-seen` — nunca se le ha visto subirlo. Lo único demostrable es que jugó **antes** de nuestra primera observación (para estar en el ladder hay que jugar), así que la fecha es **la primera observación**, no la última.
4. **La actividad se materializa** en `character_activity` ([migración 0006](../../db/migrations/0006_character_activity.sql)), recalculable entera desde `character_snapshots` con `npm run pipeline -- refresh-activity`.
5. **`refresh-aggregates` recalcula la actividad al empezar cada corrida** y filtra la población con ella mediante un `join` interno: sin fila de actividad no se entra en el agregado.
6. **Cada fila de `population_segments` guarda el reparto** (`active_by_delta`, `active_by_first_seen`) junto a `sample_size` y a la ventana.
7. **El job `player-gap` también filtra**, con la ventana medida **desde el momento del run** y no desde el reloj de hoy, y `--all` desactiva el filtro para reproducir reportes anteriores a #16.
8. **La ventana de 30 días queda soportada pero sin consumidor**: `character_activity` permite responder "season active" con una consulta, y quien la necesita es el ranking de temporada (#23), que todavía no existe.

## Por qué

**Derivar de `played` y no de "le hemos visto"** es la diferencia entre medir el meta y medir nuestra propia cadencia de descarga. El proxy anterior tenía un sesgo con dirección conocida —sobreestimar el tramo alto— y encima crecía con la frecuencia del job: cuanto más a menudo miráramos, más "activos" habría. Un número que mejora porque nosotros preguntamos más no describe nada del juego.

**Fechar `first-seen` en la primera observación y no en la última** es lo que hace que el arranque caduque solo. Si se fechara en la última, un personaje que sigue apareciendo en el leaderboard tendría actividad fresca para siempre: sería exactamente el proxy que este ADR sustituye, con otro nombre. Fechándolo en la primera, quien no vuelve a dar señales sale de la ventana de 7 días una semana después de que le viéramos por primera vez, sin que haga falta ninguna regla extra.

**Admitir `first-seen` en vez de exigir evidencia estricta** es una decisión de producto, no una comodidad: hoy la evidencia estricta daría cero población en las dos temporadas (hallazgos 2 y 3), y publicar cero segmentos es peor información que publicar segmentos que declaran de qué están hechos. La alternativa honesta a "no publicar nada" no es "publicar como si supiéramos": es publicar con el reparto de evidencia en la propia fila. Por eso `active_by_delta` y `active_by_first_seen` no son telemetría, son parte de la definición del `n`: **120 personas de las que hemos visto jugar a 3 no es la misma muestra que 120 de las que hemos visto jugar a 118**, aunque `sample_size` diga 120 en los dos casos.

Con esa cifra delante, además, la promesa del producto se puede vigilar: cuando el histórico tenga profundidad, `active_by_first_seen` debería caer, y si no cae es que algo pasa con la ingesta. Hoy es del 100 %, y el job lo dice en voz alta al terminar.

**Materializar en vez de calcular al vuelo** por dos razones que no son de rendimiento. La primera es que la serie necesaria **no cabe en la ventana**: para saber si alguien subió el contador dentro de los últimos 7 días hace falta la observación anterior, que puede caer fuera, y la fecha de arranque es por definición la más antigua de todas. La segunda es que los consumidores son varios —agregados (#15), perfil (#17), ranking (#23)— y recalcular la misma regla en cada uno es la forma segura de que acaben discrepando.

**Que la tabla admita `update` no rompe el [ADR 0002](0002-modelo-append-only.md)**, igual que no lo rompían los agregados: el append-only protege las **observaciones**, que Blizzard no volverá a dar, no los cálculos sobre ellas. La actividad de ayer no es una medida distinta de la de hoy; es la misma medida con menos datos. La serie temporal que sí importa —cuándo jugó cada uno— está en los propios snapshots.

**El `join` interno con `character_activity`** (sin fila no se entra) es la única lectura coherente con lo anterior: si "no disponible" no es "no lo usa" (regla 5), tampoco es "está activo". Colar a quien no tiene serie porque está en la tabla de snapshots sería el proxy otra vez.

**En `player-gap`, la ventana se mide desde `sampledAt`** porque un reporte tiene que poder reproducirse tal y como se publicó. Con el reloj de hoy, la población de un run de hace un mes se iría vaciando sola y el mismo comando daría dos resultados distintos sin que hubiera cambiado ni un dato.

**El sujeto pedido a mano no se filtra por actividad.** Es la persona que pregunta, no parte de la población de referencia: excluirle sería negarse a contestar a quien lleva dos semanas sin jugar, que es justamente uno de los usuarios que quiere volver.

## Consecuencias

- **La serie de agregados tiene un antes y un después, y la fecha es el 19 de agosto de 2026.** Los `population_segments` escritos antes de esa fecha están filtrados por "visto en el ladder"; los posteriores, por actividad derivada. `activity_window_days` no distingue las dos cosas por sí sola —las nuevas columnas sí—, y los agregados anteriores **no se recalculan** hacia atrás. Cualquier tendencia (#27) que cruce ese corte está comparando dos definiciones de población.
- **Hoy el 100 % de la población entra por `first-seen`.** No es un fallo del cálculo: es que el ladder de la temporada 41 está congelado y la 42 acaba de empezar. El primer `played-delta` real aparecerá en cuanto haya dos publicaciones de la temporada 42 con juego entre medias.
- **A partir del 20 de agosto de 2026 la ventana empieza a morder.** La población más antigua (primera observación del 13 de agosto) sale de la ventana de 7 días ese día. Es el comportamiento correcto y conviene no confundirlo con una pérdida de datos.
- **`refresh-aggregates` tarda más**: recalcula la actividad de la temporada entera antes de agregar, lo que implica recorrer todos los snapshots de la temporada, bracket a bracket. No llama a la API, así que no gasta cuota; el coste es de base de datos.
- **El contador del perfil queda marcado como no comparable con el del leaderboard.** Es un hecho medido, no una precaución, y afecta a cualquier cosa futura que use `matches_played` (winrate por temporada, #29). Está anotado también en [sprint-0-findings](../sprint-0-findings.md).
- **Con `--all`, `player-gap` sigue pudiendo reproducir los reportes anteriores**, y el propio reporte avisa de que sin ventana los porcentajes no describen el meta actual.
- ~~**Queda abierto el ruido de la ingesta**~~: el leaderboard se reingería aunque su contenido no cambiara en rating ni en partidas, lo que añadió ~450.000 snapshots idénticos en un solo día. No afectaba a la actividad —un contador que no sube no es actividad, se ingiera una vez o veinte—, pero sí al volumen y al coste. **Resuelto el 20 de agosto de 2026 por el [ADR 0009](0009-ingesta-por-cambio-de-poblacion.md)**, que además mueve `last_seen_at` a `character_presence`: con el filtro por fila, la última observación de la serie pasa a ser la última vez que el personaje **cambió**, y el proxy que este ADR conserva para medir el sesgo habría quedado valiendo cero siempre. La política de retención sigue abierta en #48.
