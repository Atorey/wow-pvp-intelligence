# ADR 0006 — Acumulación de población por búsqueda de personaje

**Fecha**: 19 de agosto de 2026 · **Estado**: aceptada (implementa §6 y §12 del plan; issue #14)

## Contexto

El leaderboard expone como mucho **5.000 jugadores por spec**, y ese corte no cae donde el producto lo necesita: en las specs más jugadas se queda por encima del ICP (Frost Mage no baja de ~1800, [sprint-0-findings](../sprint-0-findings.md)). Un jugador de 1600 —el usuario para el que existe Player Gap— no está en nuestra base de datos y, por tanto, no tiene contra qué compararse.

§12 nombra tres capas de población y dice cuál falta: la **población acumulada propia**, "todo personaje que ha sido consultado… por un usuario que lo buscó". El plan la califica de "necesaria, no opcional" para que Player Gap tenga sentido fuera del top de la ladder, y §28 ya reserva el sitio en el pipeline: "refresco bajo demanda cuando un usuario busca un personaje no visto recientemente", con caché corta de 15-30 minutos.

El contexto que condiciona el **cómo**: no hay web todavía. La búsqueda de personaje es #19 y entra en Phase 2. La prioridad `on-demand` de la cola existe desde #12, declarada explícitamente como "reservada para #14" ([ADR 0005](0005-cola-de-peticiones-con-prioridades.md)) y sin ningún consumidor hasta ahora.

## Decisión

1. **Un módulo, no un servicio.** `lookupCharacter()` en [apps/pipeline/src/jobs/lookup-character.ts](../../apps/pipeline/src/jobs/lookup-character.ts) recibe sus dependencias y no imprime nada; el comando `lookup-character` es solo una forma de ejercitarlo hoy. La web de #19 importará la misma función. No se levanta HTTP: sin frontend que llame, un endpoint solo añadiría preguntas de despliegue y de abuso que hoy no tienen respuesta.
2. **La búsqueda baja el perfil completo**, no solo el rating: perfil, `pvp-summary`, equipo, talentos y un `pvp-bracket` por cada Solo Shuffle que juegue. Son 4 peticiones más una por bracket. Con la prioridad `on-demand`, la más alta de §28.
3. **Los brackets no se adivinan**: salen de los enlaces que publica el propio `pvp-summary` del personaje. Un jugador de dos specs cuesta 6 peticiones, no 44.
4. **Solo Solo Shuffle.** 2v2/3v3/RBG se descartan: `class_slug` y `spec_slug` se deducen del bracket y "2v2" no nombra ninguna spec. Entran con #34, no a medias.
5. **`source = 'search'`**, un valor nuevo en `character_snapshots` ([migración 0004](../../db/migrations/0004_character_lookups.sql)). Un personaje que entra porque alguien lo buscó no es una muestra equivalente a una del leaderboard.
6. **Caché de 30 minutos** (`CHARACTER_LOOKUP_TTL_MINUTES`), medida sobre la última captura de perfil que tengamos de ese personaje, venga de una búsqueda o del muestreo. Dentro del TTL no se llama a Blizzard.
7. **El gear se le cuelga solo al bracket de la spec activa.** La API devuelve un único equipo, el que lleva puesto.
8. **Bitácora `character_lookups`**: una fila por búsqueda con qué se pidió, cómo acabó y si el personaje era nuevo.
9. **Un 404 no crea identidad.** Si el personaje existe pero no juega shuffle, su identidad sí se guarda (alimenta el autocompletado de §21) y snapshots no se inserta ninguno.

## Por qué

**`source = 'search'` en vez de reutilizar `'profile'`.** El sesgo de selección es real y el propio plan lo enuncia: "solo entran personajes que alguien buscó o que estuvieron en un leaderboard". Mientras la muestra de `sample-profiles` se elige con semilla y criterio, la de búsqueda la elige el interés de un desconocido — sobrerrepresenta a quien tiene quien lo mire. Mezclar ambas bajo la misma etiqueta haría ese sesgo **indistinguible para siempre** en un histórico que es append-only: no habría forma de reconstruir a posteriori de dónde salió cada fila. Marcarlo cuesta un valor más en un check; no marcarlo no tiene vuelta atrás.

**El gear solo a la spec activa.** Un jugador que juega tres shuffles con tres specs no lleva el mismo equipo en las tres, y la API solo sabe decirnos el de ahora. Copiarlo a los otros dos brackets sería registrar como observada una build que nadie ha visto, y esa build entraría después en el `adoption_rate` de un segmento. Es la misma regla que ya aplica `findTalentLoadout` con los talentos: se guarda lo de la spec que toca, no lo que hay a mano. El coste es que un personaje buscado aporta gear a un solo bracket; la alternativa era aportar datos inventados a tres.

**El TTL se mide sobre capturas de perfil y no sobre cualquier snapshot.** Un personaje puede tener un snapshot de leaderboard de hace diez minutos y aun así no tener gear ni talentos: darlo por fresco dejaría la búsqueda sin lo que venía a buscar.

**La caché no es solo ahorro de cuota.** Sin ella, N búsquedas seguidas del mismo personaje meten N snapshots casi idénticos. Un histórico append-only está para medir cambios, y una ráfaga de medidas iguales no mide nada — es la misma razón por la que `refresh-leaderboard` compara hashes antes de ingerir ([ADR 0004](0004-job-programado-del-leaderboard.md)).

**La bitácora, porque "necesaria, no opcional" es una hipótesis.** §12 afirma que sin esta acumulación Player Gap no funciona por debajo del corte, pero nadie ha medido cuánta población nueva aporta de verdad una búsqueda. `characters.first_seen_at` distingue a los nuevos, pero no sabe de búsquedas repetidas, de caché ni de personajes que no existen. Es la misma función que cumple `leaderboard_fetches` para la cadencia de publicación: convertir una asunción del plan en una serie de observaciones fechadas.

**El upsert de identidad se comparte con la ingesta de leaderboard** ([db/characters.ts](../../apps/pipeline/src/db/characters.ts)). La reconciliación de renombres y transferencias que motivó el issue #49 no es propia del leaderboard: una búsqueda se topa exactamente con el mismo caso, y dos implementaciones divergirían hasta partir el histórico de alguien por el lado que se olvidara.

## Consecuencias

- **La población deja de ser homogénea**, y eso es lo que se ha comprado: a partir de ahora un segmento puede mezclar jugadores del leaderboard con jugadores que alguien buscó. Cualquier agregado que declare un `sample_size` debería poder decir de qué está hecho; hoy el dato está guardado, pero **ningún consumidor lo usa todavía** — los agregados de #15 son el sitio donde esto tiene que decidirse de forma explícita.
- **No hay protección contra el abuso**, y no la hace falta mientras el único llamante sea el CLI. En cuanto haya un endpoint público, alguien puede pedir mil personajes distintos y saltarse la caché por diseño (personajes distintos, TTL distinto). El límite por IP o por sesión es trabajo de #19, y conviene que ese issue lo recoja antes de exponer nada.
- **La cuota de `on-demand` compite de verdad por primera vez.** Hasta hoy la prioridad no cambiaba nada observable porque todos los jobs eran secuenciales. El riesgo de inanición que el ADR 0005 daba por asumido (un flujo sostenido de búsquedas dejando sin turno a los agregados) pasa de teórico a posible el día que haya usuarios.
- **Un personaje buscado aporta gear a un solo bracket** de los que juega. Para `sample-profiles` esto no cambia nada, pero significa que la población acumulada por búsqueda es más rica en ratings que en builds.
- **La caché puede fallar por identidad**: si alguien busca con una grafía de reino que Blizzard normaliza a otra, la comprobación previa no encuentra la fila y se gasta la llamada. El personaje no se duplica —la identidad se guarda ya normalizada por la respuesta del perfil—, solo se paga una petición de más.
