# Base de datos

Postgres (Supabase en desarrollo). El modelo está descrito en [docs/product-plan.md](../docs/product-plan.md) §27 y la decisión de fondo en [docs/decisions/0002-modelo-append-only.md](../docs/decisions/0002-modelo-append-only.md).

## Aplicar migraciones

```bash
npm run db:migrate
```

Aplica en orden los `.sql` de `migrations/` que no consten en `schema_migrations`, cada uno en su propia transacción. Necesita `DATABASE_URL` en el `.env` de la raíz.

## Reglas

1. **Un archivo aplicado no se edita nunca.** Se añade uno nuevo con el siguiente número. Editarlo deja tu base y la de producción en estados distintos sin que nadie se entere.
2. **Toda migración debe poder aplicarse sobre una base ya poblada** (`if not exists`, `add column if not exists`, backfills explícitos).
3. **`character_snapshots` es append-only.** Ninguna migración ni job debe hacer `update` de rating/gear/talentos sobre una fila existente: el histórico es el activo más defendible del producto y se pierde en el momento en que se sobreescribe.

## Estado

| Archivo                          | Qué añade                                                                                                                                                       |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                  | `characters`, `character_snapshots`, vista `latest_snapshot_per_character_bracket`                                                                              |
| `0002_profile_snapshots.sql`     | Índice único de ingesta idempotente, columnas de perfil (ilvl, `talent_loadout_code`) y `character_snapshot_gear`                                               |
| `0003_leaderboard_fetches.sql`   | `leaderboard_fetches`: bitácora de descargas del job programado (hash de contenido y cadencia observada)                                                        |
| `0004_character_lookups.sql`     | `source='search'` en `character_snapshots` y `character_lookups`: bitácora de la acumulación por búsqueda                                                       |
| `0005_population_aggregates.sql` | `population_segments` y `aggregate_snapshots`: distribución y `adoption_rate` por segmento, con `sample_size`, `computed_at` y la ventana de actividad aplicada |

`population_segments` y `aggregate_snapshots` son las únicas tablas **derivadas**: se reconstruyen enteras desde `character_snapshots` con `npm run pipeline -- refresh-aggregates`, así que borrar un recálculo no destruye histórico de población. La regla 3 sigue valiendo tal cual para `character_snapshots`, que es la fuente de verdad — ver [ADR 0007](../docs/decisions/0007-agregados-por-segmento.md).
