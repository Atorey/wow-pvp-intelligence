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
4. **No se guarda un nivel de confianza en ninguna columna, se guarda su denominador** ([ADR 0033](../docs/decisions/0033-la-confianza-se-deriva-no-se-guarda.md)). `high` escrito en una fila es el juicio de un día congelado para meses, y es lo que dejó a `population_segments` con 59 filas `high` sobre `gear_sample = 0`. El umbral se aplica al leer, con `confidenceFor()`.

## Estado

| Archivo                                    | Qué añade                                                                                                                                                       |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_init.sql`                            | `characters`, `character_snapshots`, vista `latest_snapshot_per_character_bracket`                                                                              |
| `0002_profile_snapshots.sql`               | Índice único de ingesta idempotente, columnas de perfil (ilvl, `talent_loadout_code`) y `character_snapshot_gear`                                               |
| `0003_leaderboard_fetches.sql`             | `leaderboard_fetches`: bitácora de descargas del job programado (hash de contenido y cadencia observada)                                                        |
| `0004_character_lookups.sql`               | `source='search'` en `character_snapshots` y `character_lookups`: bitácora de la acumulación por búsqueda                                                       |
| `0005_population_aggregates.sql`           | `population_segments` y `aggregate_snapshots`: distribución y `adoption_rate` por segmento, con `sample_size`, `computed_at` y la ventana de actividad aplicada |
| `0006_character_activity.sql`              | `character_presence` y `last_active_snapshot_date`: la ventana de actividad real, no el proxy de "lo hemos vuelto a ver en el ladder"                           |
| `0007_ingesta_por_cambio_de_poblacion.sql` | `population_hash` en la bitácora de descargas: se ingiere cuando cambia la población, no cuando cambia el payload                                               |
| `0008_name_fold.sql`                       | `name_fold`: la clave con la que se _busca_ un nombre, que no es única y no es la identidad                                                                     |
| `0009_item_media.sql`                      | `item_media`: catálogo `item_id` → URL del icono, resuelto contra la Media API                                                                                  |
| `0010_cuota_compartida_de_blizzard.sql`    | `blizzard_quota`: los dos token buckets del presupuesto de Blizzard y el token de OAuth, compartidos por todos los procesos                                     |
| `0011_busqueda_por_prefijo.sql`            | Índice de prefijo sobre `name_fold` para el autocompletado                                                                                                      |
| `0012_talent_nodes.sql`                    | `character_snapshot_talents`: los talentos por nodo, que es la variable que agrupa (el código no)                                                               |
| `0013_gear_gems_and_enchants.sql`          | Gemas y encantamientos en las filas de gear                                                                                                                     |
| `0014_medicion_de_player_gap.sql`          | `player_gap_views`: una fila por render de la caja Player Gap, que es la North Star                                                                             |
| `0015_limite_por_ip_del_buscador.sql`      | `rate_limit_buckets`: token buckets por ámbito y por conexión para los endpoints abiertos de la web                                                             |
| `0016_cache_de_negativos.sql`              | `not-found-cached` en el check de `character_lookups`, que convierte la bitácora en caché de negativos                                                          |
| `0017_cobertura_servible.sql`              | `segment_coverage`: la serie de la cobertura servible por par `(spec, segmento objetivo)`, una fila por corrida                                                 |
| `0018_confianza_derivada_al_leer.sql`      | Quita `population_segments.confidence`: la confianza se deriva del denominador de cada cifra, no se guarda                                                      |

`population_segments`, `aggregate_snapshots` y `segment_coverage` son las tablas **derivadas**: se reconstruyen enteras desde `character_snapshots` con `npm run pipeline -- refresh-aggregates`, así que borrar un recálculo no destruye histórico de población. La regla 3 sigue valiendo tal cual para `character_snapshots`, que es la fuente de verdad — ver [ADR 0007](../docs/decisions/0007-agregados-por-segmento.md).

`item_media`, `blizzard_quota` y `rate_limit_buckets` no son ni observaciones ni derivadas, y por eso la regla 3 tampoco les aplica: la primera es un hecho del juego sin histórico que romper y la segunda es un contador de infraestructura que solo tiene sentido en su valor actual. `blizzard_quota` es además la única tabla de la que **depende llamar a Blizzard**: sin ella, y sin su fila, el pipeline no tiene permiso para pedir nada ([ADR 0013](../docs/decisions/0013-web-serverless-y-cuota-en-postgres.md)).
