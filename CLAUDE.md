# Contexto para agentes

Producto de analítica PvP de WoW. La feature central, y la única razón de ser del MVP, es **Player Gap**: qué separa a un jugador del siguiente segmento de rating. Estrategia completa en [docs/product-plan.md](docs/product-plan.md); estado real de los datos en [docs/sprint-0-findings.md](docs/sprint-0-findings.md).

## Estructura

- `packages/core` — dominio compartido pipeline↔web. Sin dependencias externas.
- `packages/data` — lecturas de servicio contra Postgres, las que pinta una página ([ADR 0014](docs/decisions/0014-capa-de-lectura-compartida.md)). Recibe el ejecutor, no lo crea. Ni escrituras ni consultas de cálculo: esas siguen en el pipeline.
- `apps/pipeline` — ingesta Blizzard → Postgres. CLI: `npm run pipeline -- <comando>`.
- `db/migrations` — schema versionado. `npm run db:migrate`.
- `docs/decisions` — ADRs. Si una decisión de arquitectura se revisa, se añade un ADR nuevo.
- `docs/design` — decisiones de pantalla, jerarquía y estados ([brief](docs/design/brief.md)). Lo que se ve no va a un ADR salvo que sea estructural.

Fase actual: **Phase 0 (Data Feasibility)**, casi cerrada. No hay web todavía; entra en Phase 2.

## Reglas del proyecto

1. **Append-only**: `character_snapshots` nunca se actualiza, solo se inserta ([ADR 0002](docs/decisions/0002-modelo-append-only.md)). Un `update` sobre rating/gear/talentos destruye el histórico, que es el moat del producto.
2. **Umbrales de confianza en `packages/core`** ([ADR 0003](docs/decisions/0003-umbrales-de-confianza.md)). Nada de `if (n > 30)` suelto: se usa `canShowComparison()`. Por debajo de n=30 no se muestra comparación, se explica por qué. Bajar el umbral para llenar una pantalla vacía es incumplir la promesa del producto.
3. **Correlación, nunca causalidad**, también en el copy: "el 74% del siguiente segmento lleva X", nunca "cambia X para subir".
4. **Toda llamada a Blizzard pasa por `BlizzardClient`**. Es el único punto con throttling: una cola por proceso con techo por segundo y por hora, y prioridades on-demand > batch > aggregate ([ADR 0005](docs/decisions/0005-cola-de-peticiones-con-prioridades.md)). Un `fetch` suelto rompe el ritmo global; un cliente sin prioridad declarada entra como `batch`.
5. **`null` significa "no disponible", nunca "no lo usa"**. Un `talent_loadout_code` ausente sale del denominador de `adoption_rate`; contarlo como no-adopción falsea el dato.
6. **No construir lo marcado V2/V3/Never** en §26 del plan sin decisión explícita: LFG, IA conversacional, winrate de comps, counters, multi-región.

## Convenciones

- Comentarios y documentación en español; identificadores en inglés.
- Los comentarios explican **por qué**, no qué hace la línea siguiente.
- **Los comentarios no citan issues** (`#57`, "ver #66"): el número no explica nada a quien lee el código y envejece en cuanto el issue se cierra. Si el porqué está en una decisión, se enlaza el ADR; si no, se escribe el porqué. La trazabilidad con el issue va en el mensaje de commit y en los docs.
- TypeScript estricto (`exactOptionalPropertyTypes`, `noUncheckedIndexedAccess` incluidos). Se ejecuta con `tsx`, sin paso de build.
- Tests con `node:test` para lógica pura y para lo que se pueda probar con reloj inyectable.
- Antes de dar algo por terminado: `npm run typecheck && npm test && npm run format:check`.
- **Nunca `git commit` ni `git push` sin que se haya pedido explícitamente en esa conversación.** Se deja el trabajo en el working tree y se dice qué hay cambiado; el commit lo decide quien revisa, no el agente.

## Cuidado con

- **El mockup de §13.1 del plan no es maquetable**: promete cuatro barras y solo gear es calculable. La caja Player Gap es una lista, no un panel de barras, y sus tres estados están dibujados en el [brief](docs/design/brief.md#15-los-tres-estados-de-confianza) (#57). Maquetar el ASCII del plan es trabajo perdido.
- **Talentos**: `talent_loadout_code` se reportó ausente tras el parche 11.2 y de forma desigual por clase. Validado solo sobre 3 clases de 13. No comprometer features que dependan de talentos sin ampliar esa validación.
- **Cobertura de leaderboard**: depende del punto de la temporada y se invierte con él. En una madura el tope de 5.000 corta el rango bajo del ICP en las specs más jugadas; en una recién empezada el tope no aplica y lo que falta es la parte alta — al empezar la 42, una sola spec llegaba a n≥30 en 2000-2200 ([§12 de findings](docs/sprint-0-findings.md)). No asumir cobertura de ningún tramo: se cuenta por par `(spec, segmento objetivo)` y decide `canShowComparison()` ([ADR 0010](docs/decisions/0010-cobertura-por-segmento.md)).
- **`character_snapshots` guarda cambios, no visitas**: desde el 20 de agosto de 2026 solo se inserta la fila cuyo `(rating, partidas, tier)` difiere de la observación anterior del mismo personaje ([ADR 0009](docs/decisions/0009-ingesta-por-cambio-de-poblacion.md)). Contar filas para saber cuántas veces hemos visto a alguien mide otra cosa; eso está en `character_presence`.
- **`matches_played` no es comparable entre fuentes**: el contador del perfil da un número sistemáticamente menor que el del leaderboard para el mismo personaje y bracket (595 de 595 casos medidos). Restarlos fabrica actividad que nadie jugó ([ADR 0008](docs/decisions/0008-ventana-de-actividad-por-partidas-jugadas.md)); solo se compara cada fuente consigo misma.
- **`population_segments.confidence` mide población, no base de comparación**: hay filas guardadas como `high` con `gear_sample = 0` (#76). La confianza de una comparación se deriva del denominador de esa cifra con `confidenceFor()`, nunca se lee de la columna — `packages/data` no la selecciona siquiera ([ADR 0014](docs/decisions/0014-capa-de-lectura-compartida.md), decisión 6).
- **Los issues cerrados no siempre están respaldados por el repo** (#3 y #7 se cerraron con trabajo que no estaba en el código). Verificar antes de dar algo por hecho.
