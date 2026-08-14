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

| Archivo                      | Qué añade                                                                                                         |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`              | `characters`, `character_snapshots`, vista `latest_snapshot_per_character_bracket`                                |
| `0002_profile_snapshots.sql` | Índice único de ingesta idempotente, columnas de perfil (ilvl, `talent_loadout_code`) y `character_snapshot_gear` |

Lo que **todavía no existe** y hará falta para Player Gap: `population_segments` / `aggregate_snapshots` (adoption_rate por variable y segmento, con `sample_size` y `computed_at`). Se añadirá cuando haya muestra de perfiles suficiente — ver el issue de recálculo de agregados.
