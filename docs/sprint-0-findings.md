# Sprint 0 — hallazgos verificados

Estado de la validación de datos (Phase 0). Lo que aquí se da por bueno es lo que se ejecutó de verdad contra la API real; lo que está en duda se marca como tal, incluso cuando el issue correspondiente esté cerrado.

Actualizado: 13 de agosto de 2026.

## 1. Endpoints core — funcionan (muestra pequeña)

Los 4 endpoints responden de forma coherente en EU:

| Endpoint                                                    | Resultado    |
| ----------------------------------------------------------- | ------------ |
| Character Profile                                           | ✅           |
| PvP bracket statistics (vía `pvp-summary`)                  | ✅           |
| Equipment summary (incluye gemas y encantamientos por slot) | ✅           |
| Specializations (`talent_loadout_code`)                     | ⚠️ ver abajo |

**Reserva importante**: la muestra fueron **3 personajes de 3 clases** (Monk, Paladin, Rogue). El criterio del plan (§32) pedía 10-15 personajes cubriendo varias clases, y la Semana 1 del arranque pedía 50. No está cubierto.

## 2. Talentos — el riesgo sigue abierto

`talent_loadout_code` vino poblado en 3/3 personajes. Eso es un **GO condicionado**, no un GO.

El bug del parche 11.2 (agosto 2025) no afectaba a todas las clases por igual — el foro oficial mencionaba específicamente Priest y Evoker, y ninguna de las dos está en la muestra. Comprometer la comparación de talentos en el MVP con n=3 sería exactamente el tipo de conclusión que este producto promete no sacar.

**Pendiente real**: ampliar `apps/pipeline/config/characters.eu.json` hasta cubrir las 13 clases y volver a ejecutar `validate-endpoints`, que ya desglosa el resultado por clase.

> El issue #3 ("ampliar validación a las 13 clases") figura cerrado como completado, pero en el repo solo hay 3 personajes de prueba y ningún reporte que respalde el cierre. Tratado aquí como pendiente hasta que se pueda reproducir.

## 3. Cobertura del leaderboard — depende mucho de la spec

Con ~15.000 personajes ingeridos de 3 specs, el corte del top 5.000:

| Spec               | Cobertura fiable desde                               |
| ------------------ | ---------------------------------------------------- |
| Frost Mage         | ~1800 (spec muy jugada: el top 5.000 no baja de ahí) |
| Restoration Shaman | 1400                                                 |
| Fury Warrior       | 1200                                                 |

**Consecuencia de producto**: la acumulación de población por búsqueda de usuario (§12 del plan) pasa de "requisito universal del MVP" a **requisito condicional según la popularidad de la spec**. Para specs muy jugadas no hay Player Gap creíble en el rango bajo del ICP sin ella.

**Consecuencia de diseño**: el ICP declarado es 1400-2200, pero en las specs más jugadas hoy solo se puede servir desde ~1800. O se lanza con specs de cobertura buena, o la acumulación por búsqueda entra antes del lanzamiento. Es una decisión de producto, no técnica, y sigue sin tomarse.

## 4. Lo que no está hecho

- **Muestreo de perfiles completos** (gear + talentos por segmento). Es el siguiente paso real: el leaderboard solo trae rating, y sin gear ni talentos no hay nada que comparar. El issue menciona un `sampleProfiles.ts` que no existe en el repo.
- **Schema de gear/talentos**: el issue #7 figura cerrado, pero el SQL no estaba en el repo. Reconstruido en `db/migrations/0002_profile_snapshots.sql`.
- **Primer Player Gap real** con datos completos.
- **Refresco 24-48h**: repetir la descarga y comprobar que se detectan cambios reales (§32, días 11-12). No ejecutado.
- **GO/NO-GO formal de Sprint 0**.

## 5. Estado del veredicto

Según el criterio de §32:

- Rating: fiable ✅
- Gear: fiable ✅
- Talentos: **funciona en n=3, sin confirmar por clase** ⚠️

Da para un **GO condicionado**: se puede seguir construyendo, con el plan de contingencia (Player Gap solo con gear/stats) todavía sobre la mesa hasta que la validación por clase esté hecha.
