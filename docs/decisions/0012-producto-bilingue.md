# ADR 0012 — Producto bilingüe inglés/español, con el copy fuera del dominio

**Fecha**: 22 de agosto de 2026 · **Estado**: aceptada (issue #59) · **No sustituye a ningún ADR**; levanta la nota de "copy provisional" que el [brief](../design/brief.md) arrastraba desde #57 y #58, y fija la restricción que heredan [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25) y [#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)

## Contexto

El idioma del producto no estaba decidido en ningún sitio, y hasta ahora convivían tres capas que nadie había reconciliado: el plan escribe su copy en inglés (§13.1, §13.6), `CLAUDE.md` manda documentación y comentarios en español con identificadores en inglés, y el [brief](../design/brief.md) dibujó sus wireframes en inglés declarándolos **provisionales** justamente a la espera de esta decisión.

Lo que convierte esto en un ADR y no solo en una sección del brief es que **elegir dos idiomas no es una decisión de copy**. Cambia la forma de las URL ([#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25)), la canonicalización y el `hreflang` ([#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26)), y sobre todo **dónde puede vivir el texto en el código**. El reparto queda así: la [§3 del brief](../design/brief.md#3-idioma-marca-y-tono-de-voz) decide qué dice cada hueco y con qué voz; aquí se decide qué forma tienen las URL y dónde vive la frase.

Y hay un choque que ya está en el código, no en el futuro. [`player-gap.ts`](../../packages/core/src/player-gap.ts) declara `reason: string` y lo rellena construyendo una frase en español dentro de `computePlayerGap()`. Con un solo idioma eso es discutible. Con dos es imposible — y además esa frase está en un **tercer** idioma respecto a los dos que el producto sirve: es español de documentación, no copy de producto.

El pipeline aporta el otro dato: [`BlizzardClient`](../../apps/pipeline/src/blizzard/client.ts) pide un `locale` fijo (`en_GB` por defecto) y [`character_snapshot_gear`](../../db/migrations/0002_profile_snapshots.sql) guarda `item_name` **junto a** `item_id`. Los nombres de item que tenemos son ingleses, pero la identidad de la pieza es el id, no el nombre.

## Decisión

1. **El producto se publica en inglés y en español desde el día 1, y el inglés es el idioma fuente.** El copy se escribe primero en inglés y el español es traducción, nunca al revés. No es preferencia: el formato fijo de insight de §13.6 está redactado en inglés y es el que define el contrato de datos; traducirlo de vuelta introduce ambigüedad en la única frase que el producto no puede permitirse ambigua.

2. **Prefijo de locale siempre, en las dos lenguas**: `/en/…` y `/es/…`. **No existe la versión sin prefijo.** La raíz `/` redirige con **302** —nunca 301— según `Accept-Language`, y el conmutador de idioma es visible y persistente. Un 301 desde la raíz fija en la caché del navegador y en la de Google la elección de un visitante concreto para todos los demás.

3. **Los slugs no se traducen.** `/en/spec/frost-mage/solo-shuffle/2000-2200` y `/es/spec/frost-mage/solo-shuffle/2000-2200` solo se diferencian en el prefijo. Ni las palabras estructurales (`spec`, `player`, `methodology`) ni las de entidad (`frost-mage`, `solo-shuffle`).

4. **`hreflang` recíproco entre cada par, más `x-default` apuntando a `/en/`.** Cada versión es **canónica de sí misma**: el español nunca se canonicaliza al inglés. Canonicalizar una versión a la otra es pedirle a Google que no indexe la mitad del sitio que acabamos de decidir mantener.

5. **La terminología del juego no se traduce en ninguno de los dos idiomas**: `rating`, `gear`, `bracket`, `spec`, `item level`, `Solo Shuffle`, y los nombres de clase y especialización. La evidencia está en el propio plan, que llama a su persona principal **"el que quiere subir de tier"** (§4) sin traducir "tier". El jugador hispanohablante dice "mi rating", no "mi clasificación"; traducirlo produce un texto que se lee como una traducción automática y erosiona justo lo que este producto vende, que es rigor.

6. **Los nombres de item se muestran en inglés en las dos versiones.** `item_name` es **caché de presentación**, no identidad: la identidad es `item_id`, así que servir nombres en español algún día es una tabla de traducción, no una reingesta. No entra en el MVP.

7. **El copy no vive en `packages/core`.** El dominio devuelve códigos y números; la web decide la frase. En concreto, `reason: string` se sustituye por un **código discriminado** (`"target-population-too-small"` / `"target-gear-sample-too-small"`) acompañado de las cifras que la frase necesita. Esto ya lo pedía la §1.9 del brief por otra razón —#18 tiene que distinguir las dos causas—; el bilingüe lo convierte en obligatorio.

8. **Los umbrales y las reglas de indexación son idénticos por locale.** Una página que no se indexa en inglés tampoco se indexa en español, y `canShowComparison()` no sabe de idiomas. No se publica una versión en un idioma para llenar el mapa del sitio.

9. **La regla de no-causalidad se verifica en los dos idiomas por separado.** Una traducción correcta puede introducir causalidad donde no la había: en español, "para" y el subjuntivo la cuelan sin esfuerzo. "What 2000–2200 wears more" traducido como "qué llevar para subir" es una traducción fluida y una violación de la regla 3 del proyecto.

10. **No se publica traducción automática sin revisión humana.** Con dos idiomas el copy se duplica, y la tentación de generar el segundo es real. El copy de este producto es una promesa de método, no decoración.

## Por qué

**Porque el ICP es global y el operador no.** §4 define un ICP de jugadores de WoW retail sin restricción de idioma, y §22 construye la adquisición sobre long-tail que se busca en inglés ("frost mage solo shuffle build"). Publicar solo en español renunciaría a la mayor parte de ese canal. Pero el único idioma en el que este equipo escribe con precisión es el español, y **la precisión es el producto**: un copy que se pasa de frenada con la causalidad no es un fallo de estilo, es incumplir §9.2. Bilingüe es más caro que monolingüe y es la opción que no obliga a elegir entre alcance y control sobre la frase.

**Porque el prefijo en las dos lenguas evita el problema que crea la asimetría.** La alternativa tentadora —inglés en la raíz, español bajo `/es/`— parece más limpia y sale más cara: crea dos URL para la misma página en inglés, obliga a decidir qué hace `x-default`, y convierte cualquier futuro tercer idioma en una migración de todas las URL ya indexadas. §39 cuenta la autoridad de dominio como moat; las migraciones de URL son precisamente lo que la quema.

**Porque traducir los slugs duplicaría la superficie de #26 sin comprar nada.** El término que un hispanohablante teclea en Google es "frost mage", no "mago escarcha" — la terminología del juego le llega en inglés por Discord, por las guías y por el propio meta. Traducir los slugs duplicaría las URL, complicaría los canonicals y optimizaría para una búsqueda que casi nadie hace.

**Porque el copy en el dominio era deuda antes de esta decisión.** `packages/core` existe para que pipeline y web decidan igual ([ADR 0001](0001-estructura-del-repo-y-stack.md), regla 2 del proyecto). Una frase montada con plantillas dentro de `computePlayerGap()` no es una regla compartida: es presentación viajando de polizón en la capa que no debe tenerla. El bilingüe no crea ese problema, lo hace imposible de ignorar.

## Consecuencias

- **[#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25) recibe la forma de las rutas cerrada**: las de §24 del plan, con prefijo de locale delante y sin traducir. Lo que le queda por decidir es suyo, no de idioma.
- **[#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) hereda tres reglas** que no tenía: `hreflang` recíproco con `x-default`, autocanonical por versión, y el umbral de indexación aplicado por locale sin excepción.
- **`packages/core` tiene un cambio pendiente concreto y acotado**: `PlayerGapUnavailable.reason` pasa de frase a código discriminado, con las cifras al lado. Es el mismo cambio que la §1.9 del brief ya pedía para #18, así que no es trabajo nuevo, es el mismo con una razón más.
- **[#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65) hereda una restricción de maquetación medible.** Los wireframes del brief están dibujados a ~34 caracteres de ancho y en inglés; el español no ocupa lo mismo. "No comparison yet." son 18 caracteres y "Todavía no hay comparación." son 27, en una caja donde §23 prohíbe el scroll horizontal. Los componentes se tokenizan para el texto más largo de los dos idiomas, no para el inglés.
- **Los wireframes del brief dejan de ser provisionales en cuanto al idioma**: el inglés que muestran es el idioma fuente definitivo, no un marcador de posición. Lo que sigue siendo provisional es la redacción concreta, no la lengua.
- **El pipeline no cambia hoy.** Sigue pidiendo `en_GB` y guardando `item_name` en inglés, que es lo que la decisión 6 muestra en las dos versiones. Si algún día se sirven nombres en español, la palanca es una tabla por `item_id`, no una reingesta del histórico — y eso vale precisamente porque el modelo es append-only ([ADR 0002](0002-modelo-append-only.md)) y nunca podríamos reescribir los nombres ya guardados.
- **Aparece un coste recurrente que antes no existía**: cada string nuevo nace dos veces, y la revisión de no-causalidad se hace dos veces. Es el precio aceptado de la decisión 1, y el punto 9 lo convierte en parte del trabajo en vez de en una tarea que alguien recuerda a veces.
- **Queda por decidir, y no aquí, la región de lanzamiento** (§25 la marca `[UNKNOWN]`: US o EU). Es una decisión de datos, no de idioma, y esta no la prejuzga: `/es/` no implica servir la región europea, igual que `/en/` no implica servir la americana.
