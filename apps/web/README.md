# Web

La web pública de One Rung. Next.js (App Router) desplegada serverless en Netlify: la decisión y sus motivos están en el [ADR 0013](../../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md).

```bash
npm run web          # desarrollo, en http://localhost:3000
npm run web:build    # el mismo build que corre CI y Netlify
```

## Qué hay hoy y qué no

Esto es andamiaje. Lo que existe es la estructura mínima para que las páginas de verdad tengan dónde colgarse:

|        |                                                                                                                                                                                                |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Sí** | El segmento de idioma `/[locale]`, la negociación de `Accept-Language` y los `hreflang` ([ADR 0012](../../docs/decisions/0012-producto-bilingue.md)).                                          |
| **Sí** | Entornos: qué origen se anuncia y qué se indexa en producción, en preview y en local.                                                                                                          |
| **No** | Las rutas de producto (`/spec/…`, `/player/…`) y dónde vive el copy: son de #25.                                                                                                               |
| **No** | Tokens, tipografía, tema y componentes: son de #65. `globals.css` tiene un reset y nada más.                                                                                                   |
| **No** | El pie con la línea de atribución que exige la ToU de Blizzard (§4 del [brief](../../docs/design/brief.md#4-atribución-y-no-afiliación)). **Tiene que estar antes del primer deploy público.** |
| **No** | Lecturas contra Postgres. `@wowpvp/data` ya está enlazado, pero ninguna página consulta todavía.                                                                                               |
| **No** | Llamadas a Blizzard. No las habrá hasta que la cuota viva en Postgres (#81): en serverless cada invocación cree tener el presupuesto entero.                                                   |

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
