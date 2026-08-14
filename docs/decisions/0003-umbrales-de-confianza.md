# ADR 0003 — Los umbrales de confianza viven en el código, no en la UI

**Fecha**: 13 de agosto de 2026 · **Estado**: aceptada (viene del plan, §13.4)

## Contexto

El diferencial del producto no es comparar: es **declarar cuándo la comparación no es fiable**. Ningún competidor lo hace. Es también lo primero que se erosiona bajo presión de producto — cuando una página se ve vacía, la tentación de bajar el mínimo de 30 a 15 "solo para esta pantalla" es real.

## Decisión

Los umbrales viven en `packages/core/src/confidence.ts`, compartidos por pipeline y web:

| Nivel          | Condición    | Qué se muestra                                  |
| -------------- | ------------ | ----------------------------------------------- |
| `high`         | n ≥ 100      | Insight completo                                |
| `medium`       | 30 ≤ n < 100 | Insight con aviso de muestra reducida           |
| `insufficient` | n < 30       | **Nada**: se explica por qué no hay comparación |

Toda decisión de mostrar u ocultar una comparación pasa por `canShowComparison()`. Nunca por un `if (n > algo)` suelto.

La ventana de actividad se elige con `pickActivityWindow()`: 7 días si alcanza muestra, 14 si no. **Nunca 30 para una comparación** — 30 días es ventana de "season active" para rankings; usarla para un Player Gap mezclaría metas de parches distintos y presentaría como actual algo que no lo es.

## Por qué

Una regla de producto que solo existe en la capa de presentación se relaja sin que nadie lo note. En un módulo compartido, relajarla es un cambio explícito, revisable y con tests que fallan.

Y es irreversible en un sentido que importa: la credibilidad estadística no se puede añadir a posteriori. Un producto que primero enseñó números dudosos y luego pone avisos de confianza ya perdió al usuario que comprobó que el dato no se sostenía.

## Consecuencias

- Habrá pantallas vacías, sobre todo en specs poco jugadas y en el rango bajo del ICP. Es el comportamiento correcto, no un bug que arreglar bajando el umbral.
- El % de búsquedas que acaban en `insufficient` es una métrica de salud del dato (§35 del plan): si es alto, el problema es la cobertura de población, y se arregla ingiriendo más, no relajando el mínimo.
- `null` en un dato (p. ej. `talent_loadout_code` ausente) significa "no disponible", nunca "no lo usa": esas filas salen del denominador de `adoption_rate`, no cuentan como no-adopción.
