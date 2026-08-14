# ADR 0002 — Snapshots append-only

**Fecha**: 13 de agosto de 2026 · **Estado**: aceptada (viene del plan, §27)

## Contexto

La API de Blizzard da el **estado actual** de un personaje: su rating de ahora, su gear de ahora. No da histórico. Cualquier feature de evolución, tendencia o "¿qué ha cambiado esta semana?" solo puede existir si lo construimos nosotros capturando el presente una y otra vez.

## Decisión

`character_snapshots` es **append-only**. Cada recogida de datos inserta una fila nueva; ninguna actualiza una existente. El "estado actual" de un personaje es, por definición, su snapshot más reciente (vista `latest_snapshot_per_character_bracket`).

La identidad estable es `(region, realm_slug, name_slug)`, no la spec: un personaje puede cambiar de spec entre snapshots y sigue siendo el mismo.

## Por qué

El histórico que esto genera es, con el tiempo, **el moat más defendible del producto** (§39 del plan) — más que cualquier feature visible, porque no se puede copiar rápido: un competidor que arranque dentro de un año no puede fabricar el año de snapshots que le falta.

Su coste hoy es casi nulo (filas en Postgres). Su coste si se decide más tarde es infinito: el pasado que no se capturó no se recupera.

## Consecuencias

- Ninguna migración ni job puede hacer `update` de rating/gear/talentos sobre una fila existente.
- Las agregaciones nunca se calculan sobre la tabla cruda: eso contaría al mismo jugador tantas veces como snapshots tenga. Siempre a través de la vista de último snapshot, filtrada además por ventana de actividad.
- La ingesta es idempotente por índice único `(character_id, bracket, captured_at)`, con `captured_at` = momento de la descarga. Sin eso, reingerir un archivo duplicaría población e inflaría el tamaño de muestra — y con él, la confianza declarada al usuario.
- La tabla crece rápido. Particionar por fecha cuando haga falta; el plan marca decenas de millones de filas como el punto en el que reevaluar Postgres, no antes.
