# Web

La web pública de One Rung. Next.js (App Router) desplegada serverless en Netlify: la decisión y sus motivos están en el [ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md).

```bash
npm run web          # desarrollo, en http://localhost:3000
npm run web:build    # el mismo build que corre CI y Netlify
```

## Qué hay hoy y qué no

La búsqueda de personaje, el perfil y las páginas de spec ya funcionan de punta a punta:

|        |                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sí** | El segmento de idioma `/[locale]`, la negociación de `Accept-Language` y los `hreflang` ([ADR 0012](../../docs/decisions/0012-producto-bilingue.md)).                                                                                                       |
| **Sí** | Entornos: qué origen se anuncia y qué se indexa en producción, en preview y en local.                                                                                                                                                                       |
| **Sí** | Tokens, tipografía y tema, con conmutador ([ADR 0019](../../docs/decisions/0019-sistema-visual-en-css-con-tailwind.md) y [ADR 0025](../../docs/decisions/0025-componentes-con-shadcn-ui.md)). Los componentes de datos llegan con las páginas que los usan. |
| **Sí** | Las rutas de producto y dónde vive el copy ([ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md)).                                                                                                                                              |
| **Sí** | El pie con la línea de atribución que exige la ToU de Blizzard (§4 del [brief](../../docs/design/brief.md#4-atribución-y-no-afiliación)), renderizado desde el layout.                                                                                      |
| **Sí** | La búsqueda de personaje: autocompletado sobre la población y llamada a Blizzard si no la tenemos ([ADR 0024](../../docs/decisions/0024-busqueda-de-personaje-en-la-web.md)).                                                                               |
| **Sí** | Postgres, por el pooler y una conexión por invocación ([ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md), decisión 10). Lo usan el buscador, el perfil y las páginas de spec.                                                     |
| **Sí** | El perfil de personaje: identidad, cifras propias, caja Player Gap, posición en la spec y equipamiento observado ([§2 del brief](../../docs/design/brief.md#2-la-página-fuera-de-cobertura)).                                                               |
| **Sí** | La medición de la North Star, emitida por la propia caja Player Gap, y la política de privacidad ([ADR 0028](../../docs/decisions/0028-medicion-de-primera-parte-y-sin-banner.md)). No hay banner de cookies porque no hay cookies.                         |
| **Sí** | La página de metodología: de dónde salen los datos, qué es la población observada, cómo se forman los tramos y qué significa cada nivel de confianza (§24 del [plan](../../docs/product-plan.md)).                                                          |
| **Sí** | `robots.txt`, `sitemap.xml` y la regla que decide si una página entra en el índice ([ADR 0029](../../docs/decisions/0029-que-se-indexa-y-que-no.md)).                                                                                                       |
| **Sí** | Las páginas de spec y de tramo: la tabla por tramo de rating, y el gear y los talentos de cada tramo con su base declarada.                                                                                                                                 |

## Rutas

El mapa entero, con sus reglas y sus porqués, está en el [ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md). Lo que hay que saber para tocar una página:

- **Las rutas se construyen y se parsean en `@wowpvp/core`**, sin prefijo de idioma: `playerPath()`, `specPath()`, `resolvePlayerRoute()`, `resolveSpecRoute()`. Aquí solo se les antepone el locale con `localizedPathname()`. Ninguna página monta una ruta concatenando strings.
- **Cada página resuelve sus tramos y hace una de tres cosas**: servir, `permanentRedirect()` a la forma canónica, o `notFound()`. Lo que no está en el catálogo es 404, nunca una redirección adivinada.
- **El copy está en `src/i18n/copy`**, dos diccionarios y ninguna librería. El inglés define la forma: una clave que falte en español rompe el `typecheck`.
- **`/search` y `/api/search` no están en el catálogo del ADR 0020 y no se indexan.** La primera enseña lo que un envío no pudo resolver; la segunda alimenta el autocompletado y va sin prefijo de idioma, porque devuelve identidades y son las mismas en las dos lenguas.

## Qué se indexa

Las reglas y sus porqués están en el [ADR 0029](../../docs/decisions/0029-que-se-indexa-y-que-no.md); [`src/seo/`](src/seo/) es donde viven. Lo que hay que saber antes de tocar una página:

- **Ninguna página escribe su `robots` a mano: se pide a `robotsFor()`.** Multiplica por el entorno, y esa es toda su razón de ser — el `robots` de una página pisa el del layout, así que un `index: true` suelto publicaría cada preview de Netlify en Google.
- **Una página se indexa cuando tiene contenido propio y comparable**, con el umbral de §13.4 y a través de `canShowComparison()` / `isComparable()`. La población de un escalón no basta: mide cuánta gente hay, no de cuánta sabemos algo (#76).
- **Las páginas de spec se indexan ruta a ruta, con la misma lista que publica el sitemap** (`isSpecPathIndexable` en [`src/seo/indexable.ts`](src/seo/indexable.ts)): un tramo entra si alguna de sus tres bases llega al umbral, y la spec y su modalidad si entra alguno de sus tramos. `SPEC_PAGES_PUBLISHED` quedó encendido con #99 y es el interruptor que habría que apagar si volvieran a quedarse sin contenido.
- **El sitemap se recorre, no se escribe.** Sale del catálogo de `@wowpvp/core` filtrado por la muestra de cada escalón, y su `lastModified` es el `computed_at` del dato. Los perfiles no entran nunca: son miles de rutas dinámicas contra Postgres y se descubren por enlace.

## La búsqueda

Es lo que **escribe** y lo que llama a Blizzard, junto con el botón "Actualizar" del perfil, y las dos cosas ocurren por el mismo sitio: las Server Actions de [`src/server/actions.ts`](src/server/actions.ts). El razonamiento completo está en el [ADR 0024](../../docs/decisions/0024-busqueda-de-personaje-en-la-web.md); lo que hay que saber antes de tocarlo:

- **El autocompletado no llama a Blizzard.** `GET /api/search` solo lee población. Se ejecuta una vez por pulsación de teclado y la cuota es la misma que gasta el pipeline.
- **El fallback va en un `POST`, nunca en un `GET`.** Una página que gastara cuota al renderizar la gastaría en cada precarga de Next y en cada enlace compartido.
- **El buscador funciona sin JavaScript.** Es un `<form>` con una acción detrás; las sugerencias son la mejora progresiva. Probarlo con el script desactivado es parte de darlo por bueno, porque aquí no hay tests de renderizado. Es también la razón de que el desplegable **no** sea el `Command` de shadcn: su motor hace `preventDefault()` en todos los Enter y este formulario necesita que ese Enter llegue ([ADR 0025](../../docs/decisions/0025-componentes-con-shadcn-ui.md), decisión 6).
- **"No existe" y "no se pudo mirar" son dos mensajes distintos** y no se pueden fundir: sin cuota o sin tiempo se responde lo segundo.
- **El límite por IP** es un token bucket por conexión en Postgres ([ADR 0030](../../docs/decisions/0030-limite-por-ip-y-cache-de-negativos.md)): cinco envíos por minuto y sesenta por hora, sesenta sugerencias por minuto. Lo que se guarda es un HMAC de la dirección con `RATE_LIMIT_SALT`, nunca la dirección. Cuando falla la comprobación se deja pasar, porque el presupuesto de Blizzard vive en la misma base y es la segunda puerta; cuando falta la sal, en cambio, la web no arranca.
- **Un 404 reciente no se vuelve a preguntar** durante `CHARACTER_NOT_FOUND_TTL_MINUTES`. El precio es que un personaje recién creado tarda hasta una hora en verse.

## El perfil

`/{locale}/player/{region}/{realm}/{name}` es la primera página que lee de Postgres. Cinco cosas que no se adivinan leyendo el componente:

- **La temporada es la última en la que consta ese personaje**, no la que Blizzard llame actual. Preguntárselo cuesta dos llamadas por visita, y lo que la página enseña es lo último que sabemos de él.
- **La spec y la pestaña viajan en la query** (`?spec=`, `?tab=`), nunca como tramos de ruta: el recurso es el personaje y su URL canónica es la ruta a secas ([ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md), decisión 7). La canónica que se anuncia no lleva query. Por defecto abre en la spec de mayor rating.
- **El estado de la caja Player Gap lo decide `canShowComparison()` sobre el `gear_sample` del segmento objetivo**, nunca sobre su población (decisión 3 del [ADR 0010](../../docs/decisions/0010-cobertura-por-segmento.md)). Y hay una tercera causa de "sin comparación" que la §1.5 del brief no contempla: que el perfil que falte sea el del propio personaje.
- **El item level sale de la observación que trajo el equipo**, no del snapshot más reciente. El leaderboard inserta filas sin gear cada vez que cambia el rating, así que el último snapshot casi siempre trae un null que se leería como "no lleva nada".
- **"Actualizar" respeta el TTL** de la búsqueda y no lo fuerza: es la misma cuota compartida con el pipeline, y un botón que ignore la caché es un botón de gastar. Si el perfil está fresco, la página lo dice en vez de fingir que ha refrescado algo.

## Las páginas de spec

`/{locale}/spec/{spec}`, `/{locale}/spec/{spec}/{modalidad}` y `/{locale}/spec/{spec}/{modalidad}/{tramo}` leen de los agregados diarios, siempre por la caché de proceso. Lo que no se adivina leyendo los componentes:

- **El resumen y la página de modalidad son la misma vista** mientras solo haya una modalidad publicada: la de spec a secas abre en Solo Shuffle. El tramo es su propia página.
- **Una sola población por página** (ADR 0011, punto 5). El total de la cabecera es la suma de la tabla, aunque sume tramos contados con 7 días y con 14 (ADR 0007): cada fila dice su ventana y la nota lo explica. La cabecera no enseña un "rating mediano" porque la mediana de la spec entera no se deduce de las de cada tramo; enseña el **tramo mediano**, que sí.
- **La confianza de cada fila sale de los perfiles con gear, nunca de la población**, y la tabla enseña las dos columnas juntas para que se vea que no son la misma cifra (#76).
- **El puesto en la modalidad solo se afirma con la misma corrida que los tramos.** Si la última corrida de la región no trae la spec, la tarjeta no se pinta en vez de dividir la población de un día entre el total de otro.
- **Gear y talentos van en la misma página del tramo**, no en pestañas: la canónica no lleva query y un tramo indexado por sus nodos tiene que enseñarlos ahí. Cada familia —gear, nodos con árbol de héroe, talentos PvP— se decide con su propia base, que son las mismas tres con las que se decide la indexación.
- **Las listas largas se pliegan con `<details>`, no se cortan**, y no con el `Collapsible` de shadcn: lo plegado tiene que estar en el HTML que se indexa y abrirse sin JavaScript.
- **Los dos primeros niveles de la miga de pan son texto**: la ruta de clase todavía no está decidida (#98).

## La medición y la privacidad

La North Star de §35 —_"Player Gap views con confianza High o Medium por usuario único activo semanal"_— la emite la propia caja, no la ruta. El porqué de cada pieza está en el [ADR 0028](../../docs/decisions/0028-medicion-de-primera-parte-y-sin-banner.md); lo que hay que saber para tocarlo:

- **No hay analítica de tercero, y no es una tarea pendiente.** El evento va a `POST /api/gap-view` y de ahí a `player_gap_views`. La 2.i de la ToU prohíbe transferir Data —"including anonymous, aggregate or derived data"— a terceros, y la confianza de un Player Gap es dato derivado. Añadir PostHog o Plausible es un ADR, no un `npm install`.
- **Se emite en los cuatro desenlaces**, `insufficient` y `top-segment` incluidos: son el denominador de la métrica, y la de salud del dato es la proporción del primero. Una rama de la caja que se olvide de `<GapViewEvent>` hace subir las dos cifras sola.
- **El identificador del visitante es de primera parte, anónimo y caduca a los 90 días.** No es una cookie. Sin `localStorage` disponible no se emite nada, y eso es correcto: un evento incontable engordaría el denominador sin poder entrar nunca en el numerador.
- **`/privacy` no es opcional**: la 2.p obliga a publicarla y le condiciona el contenido ([ADR 0015](../../docs/decisions/0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md), decisión 9). Su texto vive en [`src/i18n/legal`](src/i18n/legal/) y **no** en el diccionario de copy, porque el guardián causal de `copy.test.ts` vigila el copy de datos y un texto legal no lo es.
- **La dirección de contacto sale de `PRIVACY_CONTACT`.** En local y en preview puede faltar y la página se sirve sin esa línea; en producción, sin ella, la página lanza.

## La metodología

`/{locale}/methodology` es obligatoria desde el MVP (§24 del plan): es la que sostiene "correlación, nunca causalidad" y la que identifica a Blizzard como fuente del dato, que es la mitad de la 2.m que el pie ya no dice ([§4.2 del brief](../../docs/design/brief.md#42-la-línea-en-las-dos-lenguas)). Tres cosas que no se adivinan leyendo la página:

- **Su texto vive en [`src/i18n/methodology`](src/i18n/methodology/) y no en el diccionario de copy**, igual que el legal, pero por un motivo distinto: son párrafos en arrays, que el diccionario no tiene en ninguna clave. Lo que **no** comparte con el legal es la exención — este texto sí es copy de datos y pasa por el guardián causal, sin ninguna clave exenta. La lista de patrones la comparten los tres documentos desde [`src/i18n/voice.ts`](src/i18n/voice.ts).
- **Ningún umbral se teclea en un párrafo.** El documento es una función de sus cifras: `methodologyThresholds()` las saca de `@wowpvp/core` y las formatea en la lengua de la página. Un "30" escrito a mano sobrevive a que alguien mueva `MIN_SAMPLE_MEDIUM`, y deja la página explicando una aritmética que el sitio ya no hace.
- **Los apartados se enlazan por su nombre**, no con un `#` escrito a mano: el catálogo y `methodologyPath()` están en `@wowpvp/core`, como el resto de las rutas. El enlace del perfil apunta al apartado de confianza; el del pie, a la página entera.

## Componentes

Los de [`src/components/ui/`](src/components/ui/) **los genera shadcn y no los hemos escrito nosotros** ([ADR 0025](../../docs/decisions/0025-componentes-con-shadcn-ui.md)). Tienen sus propias reglas, escritas en [su README](src/components/ui/README.md): exentos de la convención de comentarios, y editables solo para tokenizar, quitar `dark:` y lo mínimo que exige `exactOptionalPropertyTypes`. Se traen con `npx shadcn@latest add <componente>` desde `apps/web`.

Todo lo demás en `src/components/` es nuestro. Dos cosas que conviene saber antes de tocar el armazón:

- **El tema lo lleva una clase en el `<html>`,** que pone `next-themes`, y hay un conmutador en el pie. Un `dark:` en un componente sigue siendo un defecto: `grep -rn "dark:" src` tiene que devolver cero.
- **El menú de móvil ya no funciona sin JavaScript.** Era un `<input type="checkbox">` con CSS detrás; ahora es un `Sheet`, y a cambio cierra con Escape, atrapa el foco y bloquea el desplazamiento de fondo. El buscador **no** entró en ese intercambio, ni tampoco el botón "Actualizar" del perfil: son las dos piezas que escriben, y las dos son `<form>` de verdad.

## Idioma

No existe la versión sin prefijo. `src/proxy.ts` intercepta cualquier ruta que llegue sin `/en` o `/es` delante y redirige con **302** al idioma que pida `Accept-Language`, con `Vary: Accept-Language` para que ninguna caché intermedia sirva el idioma del visitante anterior.

El 302 no es un detalle: un 301 se queda pegado en la caché del navegador y en la de Google, y fija para todo el mundo la preferencia del primero que pasó por ahí.

`src/i18n/alternates.ts` construye los `hreflang` recíprocos con `x-default` al inglés. Devuelve **rutas relativas**, que Next resuelve contra `metadataBase`; así los enlaces no dependen del entorno.

## Entornos

| Contexto              | Origen que se anuncia                      | ¿Se indexa? |
| --------------------- | ------------------------------------------ | ----------- |
| `next dev`            | `http://localhost:3000`                    | No          |
| Deploy preview / rama | `DEPLOY_PRIME_URL`, la URL real del deploy | No          |
| Producción            | `NEXT_PUBLIC_SITE_URL`, de `netlify.toml`  | Sí          |

Lo decide [`src/site.ts`](src/site.ts) leyendo `CONTEXT`, que rellena Netlify. La lista es blanca: solo `production` indexa, así que un contexto nuevo que nadie previó entra como no indexable en vez de colarse en el índice.

Fuera de producción el `robots.txt` cierra el sitio entero y no anuncia el sitemap: un rastreador que no lea las etiquetas se queda igualmente fuera.

Las variables están documentadas en el [`.env.example`](../../.env.example) de la raíz — el `.env` es único y vive ahí ([ADR 0001](../../docs/decisions/0001-estructura-del-repo-y-stack.md)). Las de Netlify se configuran en el sitio, no en el repo.

## Despliegue

[`netlify.toml`](../../netlify.toml), en la raíz del repo, es la configuración entera. La base del build es la raíz y no `apps/web`: la web depende de `@wowpvp/core` y `@wowpvp/data` por workspaces, y una instalación hecha dentro de `apps/web` no los ve.

Queda pendiente conectar el repositorio a un sitio de Netlify; el `netlify.toml` no se ha ejecutado nunca contra un build real.

**El plan gratuito se agota deployando, no solo sirviendo**: 300 créditos al mes, 15 por deploy a producción, y al agotarlos el sitio se pausa hasta el mes siguiente. En desarrollo activo eso muerde antes que el tráfico.

## Rendimiento y errores

El presupuesto, las cifras medidas y el porqué de todo lo de abajo están en el [ADR 0031](../../docs/decisions/0031-presupuesto-de-rendimiento-y-observabilidad.md). **TTFB p75 ≤ 800 ms y LCP p75 ≤ 2,5 s en el perfil**, con el techo duro de los 10 s de función de Netlify.

Para volver a medir, contra el mismo build que corre Netlify:

```bash
npm run web:build
npm run start --workspace @wowpvp/web
npx tsx apps/web/scripts/measure-ttfb.ts --runs 25 --path /en/player/eu/<reino>/<nombre>
```

El personaje se pasa a mano y se anota junto a la cifra: el que hoy tiene comparación puede no tenerla la semana que viene, y una constante con un nombre dentro mediría otra cosa sin avisar.

**La caché no tiene TTL.** Las lecturas de agregado —los escalones del bracket y las dos adopciones, que son iguales para todo el que mire esa spec— se recuerdan en memoria del proceso hasta que puede existir la corrida siguiente, y esa fecha sale del `computed_at` de la fila. Con la corrida retrasada entra un suelo de cinco minutos, porque una caducidad ya vencida haría fallar todas las visitas justo el día que el recálculo está caído. La página de perfil **no** lleva cabecera de caché y no debe llevarla: después de pulsar Actualizar su URL trae `?refresh=`, y esa respuesta no puede acabar en un CDN sirviéndosela a otra persona.

**La caja Player Gap dice siempre de qué corrida son sus cifras**, y si esa corrida ya debería haber sido sustituida, lo dice también. Sin fecha de vuelta.

**Quién se entera**: `src/instrumentation.ts` escribe una línea JSON por fallo de render, que Netlify recoge en los registros de función. No hay ningún tercero, y en esa línea no entra ni la IP, ni el user-agent, ni la ruta resuelta — solo su forma (`/[locale]/player/[region]/[realm]/[name]`), porque la ruta de un perfil lleva dentro el nombre del personaje. De que los agregados se queden atrás avisa `npm run pipeline -- check-freshness`, que corre a diario en el workflow `Freshness` y falla si el dato que sirve la web es de una corrida perdida.

`error.tsx` y `global-error.tsx` **pintan en cliente**: ante un fallo del render inicial Next sirve su cáscara con un 500 y nuestro texto aparece al hidratar. Es del framework y se aceptó a sabiendas; devolver un 200 con una explicación le mentiría a los rastreadores sobre una página que no ha podido leerse.

## Tests

`node:test` con `tsx`, los mismos que el resto del monorepo — **no hay vitest ni testing-library**, y es deliberado.

Lo que se prueba aquí es **mapeo puro**: negociación de idioma, construcción de rutas y `hreflang`, y qué origen se anuncia en cada entorno. Ninguna de esas funciones sabe de React, así que el runner de Node las ejecuta sin ceremonia.

Lo que no se prueba con tests unitarios es el renderizado. La razón no es pereza: la lógica que merece protección —umbrales de confianza, segmentos, procedencia de las cifras— vive en `@wowpvp/core` y `@wowpvp/data`, y ahí ya está probada. Montar un runner paralelo, con su transformador de JSX y su DOM simulado, para afirmar que un `<h1>` contiene el texto que le hemos pasado dos líneas antes es coste sin cobertura.

Lo que sí cubre el renderizado, en CI, es `npm run web:build`: una página que importa algo que no puede o que declara mal su metadata rompe el build. El día que haya un componente con lógica propia que no pueda bajar a `core` —el formato fijo de insight de #65 es el candidato— esta decisión se revisa; hasta entonces, añadir el runner sería infraestructura buscando un test.
