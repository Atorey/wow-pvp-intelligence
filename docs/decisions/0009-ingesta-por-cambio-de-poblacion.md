# ADR 0009 — Se ingiere lo que cambia de población, y solo las filas que cambian

**Fecha**: 20 de agosto de 2026 · **Estado**: aceptada (issue #53) · **Sustituye al punto 3 del [ADR 0004](0004-job-programado-del-leaderboard.md)**

## Contexto

El [ADR 0004](0004-job-programado-del-leaderboard.md) decidió que la ingesta no la decide el reloj sino el contenido: de cada descarga se guarda el hash del payload de Blizzard y solo se ingiere si difiere del anterior. El objetivo estaba bien planteado — "un `character_snapshots` lleno de repeticiones no es un histórico más denso, es uno más ruidoso" — pero el mecanismo no lo cumplía: **el 18 de agosto de 2026 se ingirieron 447.851 snapshots, ninguno con información nueva.**

Medido sobre EU antes de decidir nada:

1. **En la temporada 41, de 647.950 pares de snapshots consecutivos no hay ni un solo cambio de `rating`, `matches_played`, `matches_won`, `matches_lost` ni `pvp_tier_id`.** El ladder de una temporada terminada se congela y se republica igual (es el hallazgo 2 del [ADR 0008](0008-ventana-de-actividad-por-partidas-jugadas.md)).
2. **El `rank` explica solo una parte del ruido.** De las 148 transiciones entre publicaciones consecutivas de esa temporada, 36 movían solo el `rank`, 49 traían altas o bajas de la lista —población de verdad— y **96 no cambiaban absolutamente nada de lo que guardamos**. El payload se mueve por campos que ni siquiera ingerimos.
3. **En temporada viva, un hash mejor no basta.** En la 42, 246 de 303 publicaciones traen algún cambio real de población: cualquier huella honesta diría "cambió" en el 81 % de las corridas. Pero de las 45.793 parejas de snapshots consecutivos solo 8.391 (18 %) llevan información nueva. Las otras entran porque _otro_ jugador del bracket jugó.

El punto 3 es el que decide la forma de la solución. El problema no es solo _cuándo_ se ingiere, es _qué_ se escribe: con 40 specs, una publicación son 165.202 filas, y basta con que una persona juegue para que las 5.000 de su bracket se reescriban idénticas.

## Decisión

1. **La ingesta la decide una huella de población, no la del payload.** `hashPopulation` ([fetch-leaderboard.ts](../../apps/pipeline/src/jobs/fetch-leaderboard.ts)) se calcula sobre la proyección exacta de lo que acaba en `character_snapshots` —identidad, `rating`, `season_match_statistics`, `tier`— **ordenada por identidad**, no por el orden recibido.
2. **Se guardan las dos huellas y se miden las dos cadencias.** `content_hash` sigue registrando si Blizzard republicó (`published`), que es para lo que nació la bitácora; `population_hash` decide si se ingiere (`changed`). `refresh-leaderboard` imprime las dos.
3. **Dentro de una ingesta, solo se insertan las filas que difieren de la observación anterior** del mismo personaje, bracket y temporada, comparando `(rating, matches_played, matches_won, matches_lost, pvp_tier_id)`. Se compara contra `source = 'leaderboard'` y contra una observación **estrictamente anterior**.
4. **"Le hemos visto en la lista" se guarda aparte**, en `character_presence` ([migración 0007](../../db/migrations/0007_ingesta_por_cambio_de_poblacion.sql)): una fila por personaje, bracket y temporada, con `first_seen_at`, `last_seen_at` y en cuántas publicaciones ha aparecido. Es tabla derivada, como `character_activity`.
5. **`character_activity.last_seen_at` se toma de ahí** (`withPresence` en [refresh-activity.ts](../../apps/pipeline/src/jobs/refresh-activity.ts)), y `observations` pasa a contar observaciones con información nueva, no veces que le hemos visto.
6. **Cada corrida registra cuántas entradas descartó** (`redundant_entries`). Es el número que #48 necesita para decidir retención.
7. **Lo ya escrito no se borra aquí.** Las ~650.000 filas redundantes que hay en la tabla son alcance de #48, que es donde vive la política de retención y donde toca revisar el [ADR 0002](0002-modelo-append-only.md).

## Por qué

**Hashear la proyección y no "el payload menos el rank"** es la diferencia entre un arreglo y una carrera. El issue #53 proponía excluir el `rank`, que es lo que se veía; la medición dice que 96 de 148 transiciones no movían ni el rank. Excluir campos uno a uno significa volver aquí cada vez que Blizzard añada uno. Hasheando lo que guardamos, la huella es inmune por construcción a todo lo que quede fuera del modelo, y cuando el modelo crezca —una columna nueva del perfil— la huella crece con él en el mismo sitio.

**Ordenar por identidad** es la mitad del arreglo, no un detalle: el payload viene ordenado por rank, así que una sola alta en el corte desplaza a todos los de abajo. Sin ordenar, la huella volvería a moverse sin que cambiara nadie.

**El filtro por fila** es lo único que resuelve el caso de temporada viva, y es también lo que hace que el coste deje de depender de la actividad ajena: hoy un jugador que no juega en un mes genera ~240 filas idénticas porque sus 4.999 vecinos sí juegan. Con el filtro genera cero. El histórico no pierde nada — un dato repetido no es una medida más, es la misma medida escrita otra vez —, y las series que sí importan (rating y partidas a lo largo de la temporada) quedan idénticas, porque un escalón se define por sus cambios.

**Separar la presencia** es la contrapartida honesta. Con el filtro, `character_snapshots` deja de responder a "¿cuándo le vimos por última vez?": solo guarda cambios, así que la última fila de la serie es la última vez que **cambió**. Dejarlo así habría convertido `last_seen_at` en una copia de `last_active_at`, y con ella el número que el ADR 0008 conserva para medir el sesgo del proxy anterior a #16 — el que justificó la ventana de actividad — habría pasado a valer cero siempre. Es decir: la medida que vigila la promesa se habría apagado sola, y sin ruido. Guardarla aparte cuesta una fila por personaje en vez de una por publicación.

**Mantener las dos cadencias** porque desde este ADR ya no son la misma pregunta. Cada cuánto publica Blizzard sigue siendo lo que §28 dejó "a confirmar" y lo que decide el cron; cada cuánto cambia la población es lo que marca el ritmo real de crecimiento del histórico, y por tanto lo que decide la retención. Colapsarlas en una sola columna `changed` es exactamente el error que este ADR corrige.

**No borrar aquí lo ya escrito** porque son dos decisiones distintas y solo una está medida. Cortar el flujo es reversible y no destruye nada; podar 650.000 filas de la tabla que es el moat, no. #48 tiene ya el criterio de cierre y ahora, además, el número.

## Consecuencias

- **El volumen deja de crecer con la población y pasa a crecer con la actividad.** Sobre lo medido: la temporada 41 habría escrito **0 filas** en lugar de ~648.000, y la 42 unas 8.400 en vez de 45.800. Verificado reingiriendo los archivos en caché: 30.018 entradas recibidas, 21 filas escritas —todas altas de personajes sin observación previa— y 29.997 descartadas.
- **Reingerir un archivo sigue siendo idempotente**, y ahora en dos frentes: el índice único absorbe los snapshots y el `where` del upsert de presencia evita sumar publicaciones que nadie publicó.
- **`character_snapshots` cambia de significado el 20 de agosto de 2026**: antes era "toda observación", desde hoy es "toda observación con información nueva". Cualquier consulta que cuente filas para estimar cuántas veces hemos mirado a alguien está midiendo otra cosa a partir de esta fecha; el número que buscaba está en `character_presence.publications`.
- **La ventana de actividad no cambia de valor.** `deriveActivity` se define por subidas del contador, y las filas que se dejan de escribir son justo las que no lo suben. Lo que sí cambia es `observations`, que ya no cuenta vistas.
- **La primera corrida tras desplegar ingiere una vez por bracket** aunque no haya cambiado nada: las filas anteriores a la migración no tienen `population_hash` y no hay con qué comparar. El filtro por fila absorbe esa ingesta escribiendo cero filas, así que no hace falta tratarlo aparte.
- **La bitácora `leaderboard_fetches` tiene un antes y un después.** En las filas anteriores a la migración 0007, `changed` significaba "el payload cambió"; ese valor se ha trasladado a `published`, que es lo que de verdad medía, y `population_hash` se queda a null porque de aquellas descargas no se guardó. La serie de cadencia de publicación es continua; la de cambio de población empieza hoy.
- **La ingesta hace una consulta más por bracket** (el `lateral` que busca la observación anterior de cada personaje) y una escritura más (la presencia). A cambio escribe dos órdenes de magnitud menos filas, así que el saldo es favorable ya hoy y mejora según crece la tabla.
- **Sigue sin cerrarse #48.** Este ADR corta el flujo y aporta la medición (`redundant_entries` por corrida, y las ~650.000 filas redundantes ya escritas), pero la política de retención y el rollup siguen sin decidir.
