# ADR 0023 — El acceso a Blizzard baja a `packages/blizzard`, con las escrituras que trae consigo

**Fecha**: 1 de septiembre de 2026 · **Estado**: aceptada (issue [#19](https://github.com/Atorey/wow-pvp-intelligence/issues/19)) · **Cierra la pregunta que el [ADR 0013](0013-web-serverless-y-cuota-en-postgres.md) dejó abierta** en sus consecuencias y **extiende el [ADR 0001](0001-estructura-del-repo-y-stack.md)**, igual que hizo el [ADR 0014](0014-capa-de-lectura-compartida.md) con `packages/data`. No cambia ninguna decisión de cuota

## Contexto

El ADR 0013 decidió que la web llama a Blizzard de forma síncrona, con el jugador esperando, importando `lookupCharacter()` "tal cual". Y dejó escrita, en sus propias consecuencias, la pieza que no resolvía:

> **`packages/core` no se entera, pero `apps/pipeline` queda expuesto a la web.** Hoy `BlizzardClient` y `lookupCharacter()` viven en el pipeline, y la web tendría que importarlos cruzando apps, algo que el ADR 0001 no previó. Dónde acaba viviendo ese código compartido es de #61 y #62.

Ninguno de los dos lo resolvió. #61 creó `packages/data`, que es **solo lectura** por su decisión 2 —"ni escrituras ni consultas de cálculo: esas siguen en el pipeline"—, y #62 montó el andamiaje de la web sin llamar a Blizzard. Así que la pregunta llega intacta a #19, que es el primer trabajo que no puede seguir sin contestarla.

Lo que hay que mover no es solo el cliente. `lookupCharacter()` **escribe**: hace `upsertCharacters()` para la identidad e `insertProfileSnapshot()` para cada bracket, dentro de una transacción. Y esas dos funciones no son suyas: las comparte con la ingesta de leaderboard y con el sembrado del dataset de desarrollo.

## Decisión

1. **Aparece `packages/blizzard`.** Contiene todo lo que habla con la API —`BlizzardClient`, `RequestQueue`, `QuotaLedger`, la resolución de temporada, el mapeo de sus respuestas— y la búsqueda bajo demanda entera, `lookupCharacter()` incluida.

2. **Las escrituras de población viajan con él**: `upsertCharacters()` e `insertProfileSnapshot()` bajan al paquete. No a `packages/data`, que la decisión 2 del ADR 0014 dejó cerrado a lecturas.

3. **La configuración de Blizzard baja también**, pero no de dónde salen las variables. Los getters que leen `process.env` —cuota, región, credenciales, TTL, presupuesto de tiempo— viven en el paquete; cargar el `.env` de la raíz se queda en quien tiene un `.env` que cargar (el pipeline y, en desarrollo, la web). En Netlify no hay fichero: las variables las pone el sitio.

4. **`apps/pipeline` importa el paquete y no al revés.** El CLI, el disco (`DATA_DIR`, los JSON descargados) y los jobs se quedan arriba. `apps/pipeline/src/config.ts` re-exporta los getters mudados para que ningún job cambie de sitio de donde pide su configuración.

5. **Una app no importa de otra.** Es la regla que esta decisión fija, no solo el movimiento que hace.

## Por qué

**Porque el import cruzado no es más barato, es más caro y más tarde.** La alternativa —darle un `main` a `apps/pipeline` y declararlo dependencia de `@wowpvp/web`— no mueve ningún fichero, y por eso parece la opción sensata. Lo que hace en realidad es que la web arrastre el CLI entero, `dotenv`, `REPO_ROOT` y las rutas a `data/` en su grafo de módulos, y que un `next build` empiece a depender de que nada de eso se ejecute al importar. El día que alguien añada un `console.log` de arranque a un job, o un `fs.mkdirSync` al importar, la web se entera en producción. Un paquete con una superficie declarada no tiene ese modo de fallo.

**Porque el precedente ya está sentado y es el mismo problema.** El ADR 0014 abrió `packages/data` con este argumento exacto: el reparto de `apps/` + `packages/core` no tenía sitio para algo que comparten pipeline y web y que necesita `pg`. Aquello eran lecturas; esto son llamadas a una API con cuota compartida y las escrituras que las acompañan. Resolverlo de otra forma sería tener dos respuestas distintas a la misma pregunta según qué día se hizo.

**Porque las escrituras no se pueden quedar atrás sin romper algo peor.** Dejar `upsertCharacters()` en el pipeline e inyectarlo en `lookupCharacter()` mantendría la foto de "el paquete no escribe", a cambio de una indirección que no protege de nada: el paquete seguiría escribiendo, solo que con una función que le pasan. Y lo que esa función resuelve —renombres y transferencias, el issue #49— es exactamente lo que no puede tener dos implementaciones: dos versiones divergentes parten el histórico de alguien por el lado que se olvide de actualizar, y el histórico es el moat (ADR 0002).

**Porque `packages/blizzard` con un `upsert` dentro es raro de leer, y aun así es lo correcto.** El nombre sugiere "cliente HTTP" y el contenido es más que eso: es "hablar con Blizzard y convertir lo que responde en población". La alternativa sería un tercer paquete solo para las escrituras, con `upsertCharacters()` de un lado y `lookupCharacter()` del otro llamándolo — tres paquetes y un salto más para una función que hoy tiene dos llamantes. El coste de la rareza es un párrafo de documentación; el de la partición prematura, un import más en cada job.

**Porque `seed` importando `@wowpvp/blizzard` es el precio, y es pequeño.** El sembrado del dataset de desarrollo no toca Blizzard y aun así pasa a importar el paquete, porque usa el mismo `upsert` de identidades. Se acepta: lo que importa es la función de escritura, no la API, y `seed` ya se negaba a escribir en cualquier host que no sea local (ADR 0018), que es la protección que de verdad lo separa de producción.

## Consecuencias

- **Un `fetch` a Blizzard fuera de este paquete pasa a ser visible.** Antes la regla 4 del proyecto —"toda llamada a Blizzard pasa por `BlizzardClient`"— era una convención dentro de una app; ahora hay una frontera de paquete que la sostiene.
- **`apps/pipeline/src/config.ts` deja de ser el sitio donde se decide un número de cuota** y pasa a ser el sitio donde se carga el `.env`. Los valores viven en el paquete, que es lo que garantiza que el pipeline y la web lean el mismo techo horario — y el ADR 0013 ya avisó de que un proceso mal configurado rellena el bucket a otro ritmo.
- **El orden de carga del `.env` importa y no lo comprueba nadie.** Los getters leen `process.env` cuando se les llama, así que basta con que el módulo que carga `dotenv` se haya evaluado antes; hoy lo garantiza que tanto el CLI como los módulos de servidor de la web importan su config. Si algún día un módulo del paquete leyera el entorno **al importarse**, esto dejaría de cumplirse en silencio.
- **`quota.integration.test.ts` se queda en `apps/pipeline`**, no en el paquete: necesita el runner de migraciones y la guarda de base local, que son de la app. Prueba el `QuotaLedger` importándolo como cualquier consumidor.
- **`packages/blizzard` depende de `packages/data`** por el tipo `Queryable`, que es como el cliente recibe el ejecutor donde vive la cuota. Es una dependencia de tipo, no de consultas: el paquete no lee nada por ahí.
- **Queda un módulo compartido a medias**: `fetch-leaderboard.ts` conserva la descarga a disco y cede `resolveCurrentSeasonId()`, que la búsqueda necesita igual. La línea que separa una cosa de otra es el disco.
