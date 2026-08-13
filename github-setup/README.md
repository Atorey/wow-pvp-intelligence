# GitHub setup

Crea el repo, labels, milestones (= las 6 fases del roadmap) y todo el backlog de issues
a partir del plan de producto. No es código de producto — es tooling de gestión, se
puede borrar esta carpeta una vez montado el repo si prefieres no dejarla versionada
(o dejarla, para poder re-crear issues en el futuro si hace falta).

**No se te pide ningún token ni contraseña en ningún momento** — todo pasa por
`gh` (GitHub CLI), que gestiona el login de forma segura en tu propia máquina.

## Orden de ejecución

Desde la carpeta `wow-analytics` (la raíz del proyecto, un nivel por encima de
`sprint0-data-validation` y `github-setup`):

```powershell
# 1. Repo, labels, milestones
.\github-setup\setup-repo.ps1

# 2. Todos los issues del backlog (crea ~38, cierra automáticamente los ya
#    completados en Sprint 0 y los "won't do", con el resultado/razón real)
.\github-setup\create-issues.ps1
```

## Qué esperar

- `setup-repo.ps1` te pedirá loguearte si `gh auth status` falla — sigue las
  instrucciones en pantalla (abre el navegador, es el flujo normal de GitHub).
- Crea el repo `wow-pvp-intelligence` como **privado**.
- `create-issues.ps1` tarda unos segundos por issue (llamadas a la API de
  GitHub) — con ~38 issues, cuenta 1-2 minutos.
- Al final verás un resumen: creados / cerrados automáticamente / fallos.
  Si hay fallos, la causa más común es que un label o milestone no se creó
  bien en el paso 1 — revisa el nombre exacto en `labels.json`/`milestones.json`.

## Después de esto

En el repo tendrás:
- **6 milestones** (Phase 0 a Phase 5), cada uno con su criterio de GO/NO-GO
  en la descripción.
- **~30 issues abiertos**, ya priorizados (labels `priority:core-mvp`,
  `mvp-plus`, `v2`, `v3`) y organizados por fase.
- **~8 issues cerrados**, documentando lo que ya se validó en Sprint 0 (con
  el resultado real, no solo "hecho") y lo que se decidió explícitamente NO
  construir (`priority:never`) y por qué.

A partir de aquí, cada vez que avancemos en una tarea del plan, la gestionamos
como progreso en estos issues en vez de solo en la conversación — así queda
registrado de forma persistente y consultable.
