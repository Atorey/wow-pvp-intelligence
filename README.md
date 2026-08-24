# WoW PvP Intelligence

Plataforma de analítica PvP para World of Warcraft, sin addon: **población → contexto → comparación → progresión**.

La única razón de ser del producto en su primera versión es **Player Gap**: decirle a un jugador, con datos y con honestidad sobre la incertidumbre, qué le separa del siguiente segmento de rating. Todo lo demás existe para sostener eso.

Estrategia completa: [docs/product-plan.md](docs/product-plan.md).

## Estructura

```
apps/
  pipeline/     Ingesta: Blizzard API → Postgres (append-only). Es lo único que existe hoy.
  web/          (aún no creado) Next.js. Entra en Phase 2, cuando haya Player Gap real.
packages/
  core/         Dominio compartido pipeline↔web: catálogo de specs, segmentos de
                rating, umbrales de confianza y ventanas de actividad.
db/migrations/  Schema versionado. Se aplica con npm run db:migrate.
docs/           Plan de producto, hallazgos de Sprint 0 y decisiones (ADRs).
```

`packages/core` existe por un motivo concreto: los umbrales de confianza y los límites de segmento tienen que ser **idénticos** en el pipeline y en la web. Si se duplican, un día divergen y el producto empieza a enseñar comparaciones que su propia metodología no respalda.

## Arrancar

```bash
npm install
cp .env.example .env        # rellena credenciales de Blizzard y DATABASE_URL
npm run db:migrate
npm run pipeline -- --help
```

Para conseguir las credenciales de Blizzard, ver [apps/pipeline/README.md](apps/pipeline/README.md).

| Comando                                             | Qué hace                                                               |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `npm run pipeline -- validate-endpoints`            | Valida perfil/rating/equipo/talentos contra personajes reales          |
| `npm run pipeline -- fetch-leaderboard`             | Descarga el leaderboard de Solo Shuffle de las specs activas           |
| `npm run pipeline -- ingest-leaderboard`            | Carga lo descargado en Postgres e imprime la distribución por segmento |
| `npm run pipeline -- backfill-name-fold`            | Rellena `characters.name_fold` tras aplicar la migración 0008          |
| `npm run db:migrate`                                | Aplica las migraciones pendientes                                      |
| `npm run typecheck` / `npm test` / `npm run format` | Calidad                                                                |

## Estado

**Phase 0 — Data Feasibility, en curso.** El detalle vive en los issues del repo (milestones = fases del roadmap); lo verificado hasta ahora, con sus reservas, está en [docs/sprint-0-findings.md](docs/sprint-0-findings.md).

Resumen honesto:

- ✅ Los 4 endpoints core responden bien en EU — sobre una muestra de 3 personajes / 3 clases.
- ⚠️ `talent_loadout_code` presente en esa muestra, pero **3 clases de 13 no bastan** para comprometer la comparación de talentos: el bug de 11.2 no afectaba a todas por igual.
- ✅ Leaderboard de 3 specs ingerido; la cobertura por debajo de 1800 depende mucho de la spec.
- ⬜ Muestreo de perfiles completos (gear + talentos) → **siguiente paso real**.
- ⬜ Primer Player Gap con datos completos, y GO/NO-GO formal de Sprint 0.

## Reglas que no se negocian

Salen del plan y están implementadas en código, no solo escritas aquí:

1. **Append-only.** `character_snapshots` nunca se sobreescribe ([ADR 0002](docs/decisions/0002-modelo-append-only.md)).
2. **Nada por debajo de n=30.** Si la muestra no llega, se explica; no se rellena con un número poco fiable ([ADR 0003](docs/decisions/0003-umbrales-de-confianza.md)).
3. **Correlación, nunca causalidad.** El producto dice "el X% del siguiente segmento hace esto", jamás "esto te subirá de rating".
4. **Todo insight es trazable**: tamaño de muestra y fecha de cálculo, siempre.
