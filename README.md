# WoW PvP Intelligence

Plataforma web de analítica PvP para World of Warcraft — sin addon, población → contexto → comparación → progresión.

## Estructura del repo

- **`sprint0-data-validation/`** — código de Sprint 0 (Phase 0 del roadmap): validación de la API de Blizzard, ingesta de leaderboard, muestreo de perfiles, y el primer cálculo de Player Gap. Ver su propio `README.md` para instrucciones de setup paso a paso.
- **`github-setup/`** — scripts para crear el repo, labels, milestones e issues a partir del backlog completo del plan de producto (no es código de producto, es tooling de gestión — se puede borrar una vez usado).

## Estado actual

Sprint 0 en curso — ver el milestone **"Phase 0 — Data Feasibility"** en Issues para el detalle exacto de qué está hecho y qué falta. Resumen rápido a la fecha de este commit:

- ✅ Los 4 endpoints core de la API de Blizzard (perfil, rating PvP, equipo, talentos) confirmados como fiables.
- ✅ Leaderboard de Solo Shuffle ingerido para 3 specs (Frost Mage, Restoration Shaman, Fury Warrior), ~15.000 personajes.
- ✅ Primera distribución de rating por segmento calculada — confirma que la cobertura del leaderboard solo (sin acumulación por búsqueda de usuario) depende de la popularidad de la spec.
- 🔄 Muestreo de perfiles completos (gear + talentos) por segmento — en curso.
- ⬜ Primer Player Gap real con datos completos — siguiente paso.

## Roadmap

Ver los 6 milestones en la pestaña Issues del repo (Phase 0 a Phase 5). Cada fase tiene su criterio de GO/NO-GO documentado en el issue de milestone correspondiente.

## Principios del producto

Ver `PRODUCT_PLAN.md` (si lo añades a este repo) para el documento de estrategia completo — en particular, todo insight de producto debe llevar tamaño de muestra y nivel de confianza visible, y el lenguaje nunca implica causalidad ("esto te subirá de rating"), solo correlación observada.
