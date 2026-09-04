# Web

La web pública de One Rung. Next.js (App Router) desplegada serverless en Netlify: la decisión y sus motivos están en el [ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md).

```bash
npm run web          # desarrollo, en http://localhost:3000
npm run web:build    # el mismo build que corre CI y Netlify
```

## Qué hay hoy y qué no

La búsqueda de personaje y el perfil ya funcionan de punta a punta; el resto de páginas siguen siendo andamiaje:

|        |                                                                                                                                                                                                                                                             |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sí** | El segmento de idioma `/[locale]`, la negociación de `Accept-Language` y los `hreflang` ([ADR 0012](../../docs/decisions/0012-producto-bilingue.md)).                                                                                                       |
| **Sí** | Entornos: qué origen se anuncia y qué se indexa en producción, en preview y en local.                                                                                                                                                                       |
| **Sí** | Tokens, tipografía y tema, con conmutador ([ADR 0019](../../docs/decisions/0019-sistema-visual-en-css-con-tailwind.md) y [ADR 0025](../../docs/decisions/0025-componentes-con-shadcn-ui.md)). Los componentes de datos llegan con las páginas que los usan. |
| **Sí** | Las rutas de producto y dónde vive el copy ([ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md)). Las páginas existen y todavía no enseñan datos.                                                                                              |
| **Sí** | El pie con la línea de atribución que exige la ToU de Blizzard (§4 del [brief](../../docs/design/brief.md#4-atribución-y-no-afiliación)), renderizado desde el layout.                                                                                      |
| **Sí** | La búsqueda de personaje: autocompletado sobre la población y llamada a Blizzard si no la tenemos ([ADR 0024](../../docs/decisions/0024-busqueda-de-personaje-en-la-web.md)).                                                                               |
| **Sí** | Postgres, por el pooler y una conexión por invocación ([ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md), decisión 10). Lo usan el buscador y el perfil.                                                                          |
| **Sí** | El perfil de personaje: identidad, cifras propias, caja Player Gap, posición en la spec y equipamiento observado ([§2 del brief](../../docs/design/brief.md#2-la-página-fuera-de-cobertura)).                                                               |
| **No** | Las páginas de spec y de segmento, que siguen enseñando su dirección y nada más.                                                                                                                                                                            |

## Rutas

El mapa entero, con sus reglas y sus porqués, está en el [ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md). Lo que hay que saber para tocar una página:

- **Las rutas se construyen y se parsean en `@wowpvp/core`**, sin prefijo de idioma: `playerPath()`, `specPath()`, `resolvePlayerRoute()`, `resolveSpecRoute()`. Aquí solo se les antepone el locale con `localizedPathname()`. Ninguna página monta una ruta concatenando strings.
- **Cada página resuelve sus tramos y hace una de tres cosas**: servir, `permanentRedirect()` a la forma canónica, o `notFound()`. Lo que no está en el catálogo es 404, nunca una redirección adivinada.
- **El copy está en `src/i18n/copy`**, dos diccionarios y ninguna librería. El inglés define la forma: una clave que falte en español rompe el `typecheck`.
- **`/search` y `/api/search` no están en el catálogo del ADR 0020 y no se indexan.** La primera enseña lo que un envío no pudo resolver; la segunda alimenta el autocompletado y va sin prefijo de idioma, porque devuelve identidades y son las mismas en las dos lenguas.

## La búsqueda

Es lo que **escribe** y lo que llama a Blizzard, junto con el botón "Actualizar" del perfil, y las dos cosas ocurren por el mismo sitio: las Server Actions de [`src/server/actions.ts`](src/server/actions.ts). El razonamiento completo está en el [ADR 0024](../../docs/decisions/0024-busqueda-de-personaje-en-la-web.md); lo que hay que saber antes de tocarlo:

- **El autocompletado no llama a Blizzard.** `GET /api/search` solo lee población. Se ejecuta una vez por pulsación de teclado y la cuota es la misma que gasta el pipeline.
- **El fallback va en un `POST`, nunca en un `GET`.** Una página que gastara cuota al renderizar la gastaría en cada precarga de Next y en cada enlace compartido.
- **El buscador funciona sin JavaScript.** Es un `<form>` con una acción detrás; las sugerencias son la mejora progresiva. Probarlo con el script desactivado es parte de darlo por bueno, porque aquí no hay tests de renderizado. Es también la razón de que el desplegable **no** sea el `Command` de shadcn: su motor hace `preventDefault()` en todos los Enter y este formulario necesita que ese Enter llegue ([ADR 0025](../../docs/decisions/0025-componentes-con-shadcn-ui.md), decisión 6).
- **"No existe" y "no se pudo mirar" son dos mensajes distintos** y no se pueden fundir: sin cuota o sin tiempo se responde lo segundo.
- **El límite por IP todavía no existe** (#71). Lo que hoy acota el daño es el colchón reservado del bucket de cuota.

## El perfil

`/{locale}/player/{region}/{realm}/{name}` es la primera página que lee de Postgres. Cinco cosas que no se adivinan leyendo el componente:

- **La temporada es la última en la que consta ese personaje**, no la que Blizzard llame actual. Preguntárselo cuesta dos llamadas por visita, y lo que la página enseña es lo último que sabemos de él.
- **La spec y la pestaña viajan en la query** (`?spec=`, `?tab=`), nunca como tramos de ruta: el recurso es el personaje y su URL canónica es la ruta a secas ([ADR 0020](../../docs/decisions/0020-mapa-de-rutas-del-sitio.md), decisión 7). La canónica que se anuncia no lleva query. Por defecto abre en la spec de mayor rating.
- **El estado de la caja Player Gap lo decide `canShowComparison()` sobre el `gear_sample` del segmento objetivo**, nunca sobre su población (decisión 3 del [ADR 0010](../../docs/decisions/0010-cobertura-por-segmento.md)). Y hay una tercera causa de "sin comparación" que la §1.5 del brief no contempla: que el perfil que falte sea el del propio personaje.
- **El item level sale de la observación que trajo el equipo**, no del snapshot más reciente. El leaderboard inserta filas sin gear cada vez que cambia el rating, así que el último snapshot casi siempre trae un null que se leería como "no lleva nada".
- **"Actualizar" respeta el TTL** de la búsqueda y no lo fuerza: es la misma cuota compartida con el pipeline, y un botón que ignore la caché es un botón de gastar. Si el perfil está fresco, la página lo dice en vez de fingir que ha refrescado algo.

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

Las variables están documentadas en el [`.env.example`](../../.env.example) de la raíz — el `.env` es único y vive ahí ([ADR 0001](../../docs/decisions/0001-estructura-del-repo-y-stack.md)). Las de Netlify se configuran en el sitio, no en el repo.

## Despliegue

[`netlify.toml`](../../netlify.toml), en la raíz del repo, es la configuración entera. La base del build es la raíz y no `apps/web`: la web depende de `@wowpvp/core` y `@wowpvp/data` por workspaces, y una instalación hecha dentro de `apps/web` no los ve.

Queda pendiente conectar el repositorio a un sitio de Netlify; el `netlify.toml` no se ha ejecutado nunca contra un build real.

**El plan gratuito se agota deployando, no solo sirviendo**: 300 créditos al mes, 15 por deploy a producción, y al agotarlos el sitio se pausa hasta el mes siguiente. En desarrollo activo eso muerde antes que el tráfico.

## Tests

`node:test` con `tsx`, los mismos que el resto del monorepo — **no hay vitest ni testing-library**, y es deliberado.

Lo que se prueba aquí es **mapeo puro**: negociación de idioma, construcción de rutas y `hreflang`, y qué origen se anuncia en cada entorno. Ninguna de esas funciones sabe de React, así que el runner de Node las ejecuta sin ceremonia.

Lo que no se prueba con tests unitarios es el renderizado. La razón no es pereza: la lógica que merece protección —umbrales de confianza, segmentos, procedencia de las cifras— vive en `@wowpvp/core` y `@wowpvp/data`, y ahí ya está probada. Montar un runner paralelo, con su transformador de JSX y su DOM simulado, para afirmar que un `<h1>` contiene el texto que le hemos pasado dos líneas antes es coste sin cobertura.

Lo que sí cubre el renderizado, en CI, es `npm run web:build`: una página que importa algo que no puede o que declara mal su metadata rompe el build. El día que haya un componente con lógica propia que no pueda bajar a `core` —el formato fijo de insight de #65 es el candidato— esta decisión se revisa; hasta entonces, añadir el runner sería infraestructura buscando un test.
