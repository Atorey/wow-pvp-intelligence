# ADR 0001 — Estructura del repo y stack

**Fecha**: 13 de agosto de 2026 · **Estado**: aceptada

## Contexto

Sprint 0 dejó código funcional en una carpeta llamada `sprint0-data-validation`, más una carpeta de tooling de GitHub ya consumida. Ese código no es desechable: el cliente de Blizzard y la ingesta son la base directa del pipeline de Phase 1. Con el nombre que tenía, invitaba a tratarlo como un experimento y reescribirlo.

Además, Phase 2 traerá una web Next.js que necesita compartir con el pipeline exactamente los mismos umbrales de confianza y límites de segmento.

## Decisión

Monorepo con workspaces de npm:

- `packages/core` — dominio puro sin dependencias: catálogo de specs, segmentos de rating, umbrales de confianza, ventanas de actividad.
- `apps/pipeline` — ingesta y jobs, con un CLI único.
- `apps/web` — Next.js, cuando toque (Phase 2).
- `db/migrations` — schema versionado con un runner propio de ~50 líneas.

Stack, siguiendo §29 del plan: TypeScript en todo, Postgres (Supabase), `tsx` para ejecutar sin paso de build, `node:test` para tests. Sin ORM, sin framework de migraciones, sin cola de jobs todavía.

## Por qué

**Lo compartido va en `core` porque duplicarlo es un riesgo de producto, no de mantenimiento.** Si la web decide enseñar una comparación con n=25 porque su copia del umbral se quedó desactualizada, el producto incumple su promesa central. Un único módulo compartido lo hace imposible por construcción.

**Sin build ni ORM porque el volumen no lo justifica.** El plan es explícito en no sobrearquitecturar: BullMQ, Redis y orquestadores entran cuando haya jobs programados de verdad (Phase 1), no antes.

**Tests con el runner de Node** (sin vitest/jest) porque las tres cosas que hoy merecen test — segmentos, confianza y throttling — son funciones puras o con reloj inyectable.

## Consecuencias

- `npm run typecheck` y `npm test` cubren todo el monorepo desde la raíz.
- El `.env` es único y vive en la raíz: un solo sitio para los secretos.
- Cuando entre `apps/web`, traerá su propio tsconfig extendiendo `tsconfig.base.json`, sin tocar nada más.
- **Ampliado el 22 de agosto de 2026 por el [ADR 0014](0014-capa-de-lectura-compartida.md)**: el reparto de arriba no tenía sitio para las lecturas que comparten pipeline y web —`core` es dominio puro y esto necesita `pg`—, así que aparece `packages/data`. La regla de fondo no cambia: lo que se duplicaría es un riesgo de producto, no de mantenimiento.
- Un job nuevo que llame a `fetch` directamente en vez de a `BlizzardClient` rompe el throttling global. Está documentado en el README del pipeline, pero no hay nada que lo impida automáticamente.
