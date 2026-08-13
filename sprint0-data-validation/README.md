# Sprint 0 — Validación de datos (días 1-3)

Este script comprueba, contra la API real de Blizzard y para personajes reales de EU,
si los 4 endpoints core que necesita el producto son fiables:

1. Perfil del personaje
2. Rating PvP por bracket (`pvp-summary` → `pvp-bracket`)
3. Equipo (gear, gemas, encantamientos)
4. **Talentos** (`specializations` → `talent_loadout_code`) — este es el riesgo activo
   descrito en la sección 30 del plan de producto: el campo desapareció para muchos
   personajes tras el parche 11.2 (agosto 2025). Este script es justo lo que hace
   falta para confirmar si sigue roto o ya está resuelto.

Al final, el script te da un veredicto GO / GO CONDICIONADO / ACTIVAR CONTINGENCIA,
igual que el criterio de la sección 32 (Sprint 0) del documento de producto.

## Paso 1 — Crear el client ID de Blizzard (no lo tienes todavía)

1. Entra en **https://develop.battle.net** e inicia sesión con tu cuenta de Battle.net
   (si no tienes cuenta, créala — es gratis).
2. Ve a **https://develop.battle.net/access** y pulsa **"Create Client"** (a veces
   aparece como "Create New Client").
3. Rellena:
   - **Client name**: algo identificable, p. ej. `wow-pvp-intel-sprint0`. Ojo: el
     nombre puede ser visible públicamente y debe ser único.
   - **Redirect URIs**: no lo necesitamos de verdad porque usamos el flujo
     *client credentials* (sin login de usuario), pero el formulario suele pedir
     uno igualmente — pon `https://localhost:8080` como placeholder.
   - Descripción / uso previsto: describe brevemente el proyecto.
4. Al guardar, verás tu **Client ID** y **Client Secret** en la página de acceso
   (`develop.battle.net/access`). Guarda el secret ahora — algunas veces solo se
   muestra una vez.

## Paso 2 — Configurar el proyecto

```bash
npm install
cp .env.example .env
```

Edita `.env` y pega tu `BLIZZARD_CLIENT_ID` y `BLIZZARD_CLIENT_SECRET`.
`BLIZZARD_REGION` ya viene puesto en `eu` (decisión de la región de lanzamiento).

## Paso 3 — Meter personajes reales de prueba

Edita `characters.eu.json` y sustituye los 3 placeholders por **10-15 personajes
reales que conozcas** (tú, gente de tu Discord de PvP), **cubriendo varias clases
distintas** — así lo pide la tarea de Sprint 0 día 1-2. El `realmSlug` es el nombre
del reino en minúsculas y con guiones (p. ej. "Twisting Nether" → `twisting-nether`).

```json
[
  { "realmSlug": "twisting-nether", "name": "nombrepersonaje" },
  { "realmSlug": "kazzak", "name": "otropersonaje" }
]
```

## Paso 4 — Ejecutar

```bash
npm run validate
```

Verás en consola un reporte por personaje (✅/⚠️/❌ por cada endpoint) y un resumen
final con el veredicto GO/NO-GO sobre talentos. También se guarda un
`report.json` con el detalle completo, por si quieres compartirlo o analizarlo
después.

## Qué hacer con el resultado

- **GO** (talentos ok al 100%): sigue el plan tal cual — Player Gap incluye
  comparación de talentos desde el lanzamiento (sección 25).
- **GO CONDICIONADO** (fallo puntual <20%): revisa si el fallo se concentra en
  alguna clase concreta antes de decidir.
- **Contingencia** (fallo ≥20%): Player Gap se lanza solo con gear/stats, sin
  talentos, tal como ya está previsto en la sección 11 y 30 del plan de producto
  — no es un bloqueante del proyecto, es un escenario ya contemplado.

Este mismo código (`src/blizzard.ts` en particular) es la base directa del job de
ingesta real de la Semana 1-2 (Phase 1, "Internal Data Platform") — no es
desechable, es el punto de partida.

---

## Días 3-5 — Descargar el leaderboard de Solo Shuffle

Una vez validados los endpoints de personaje (paso anterior), toca descargar el
leaderboard completo de Solo Shuffle para 3-5 specs, hasta el tope de 5.000 que
expone la API de Blizzard (sección 30 del plan de producto).

```bash
npm run leaderboard
```

Por defecto descarga **Frost Mage, Restoration Shaman y Fury Warrior** (las specs
que ya recomendaba el plan para arrancar). Para cambiar las specs, edita
`SPECS_TO_FETCH` en `src/specs.ts` — el catálogo completo de las 13 clases /
~39 specs de retail ya está definido en `ALL_SPECS` en ese mismo archivo, solo
tienes que añadir/quitar entradas.

El script:
1. Resuelve automáticamente el ID de la temporada actual (`pvp-season/index`).
2. Descarga el leaderboard de cada spec configurada.
3. Guarda el JSON crudo de cada bracket en `data/leaderboard/`.
4. Imprime un resumen con nº de entradas, rating máximo y el corte inferior
   del top devuelto.

**Aviso importante:** si alguna spec devuelve 0 entradas, no asumas que nadie la
juega — hay un fallo documentado en el foro oficial de Blizzard donde el
endpoint de leaderboard responde vacío para ciertos brackets de Solo Shuffle en
ciertas combinaciones de temporada/namespace. El script te avisa de esto
explícitamente cuando pasa; si ves el aviso, reintenta más tarde antes de
descartar la spec.

Con esto completo, el siguiente bloque del Sprint 0 (días 5-7) es diseñar el
schema mínimo de Postgres e ingerir este dataset crudo — dímelo cuando quieras
seguir con eso.

---

## Días 5-7 — Schema + ingesta en Postgres/Supabase

### 1. Crear el schema

Abre el **SQL Editor** de tu proyecto Supabase y pega el contenido de
`schema.sql` (raíz del proyecto). Ejecútalo — crea `characters` y
`character_snapshots`, siguiendo el principio append-only de la sección 27
del plan (nunca se sobreescribe una fila, cada ingesta añade snapshots
nuevos).

### 2. Configurar la conexión

En Supabase: **Project Settings → Database → Connection string → URI**.
Cópiala en `DATABASE_URL` dentro de tu `.env`. Usa la contraseña de la base
de datos (te la pide/genera Supabase al crear el proyecto, no es tu
contraseña de cuenta).

```bash
npm install
```

(esto instala `pg`, que se ha añadido como dependencia nueva)

### 3. Ingerir el dataset descargado

```bash
npm run ingest
```

El script:
1. Detecta automáticamente qué archivos de `data/leaderboard/` corresponden
   a qué spec (comparando contra el catálogo `ALL_SPECS` de `src/specs.ts`,
   no adivinando a partir del nombre del archivo).
2. Hace upsert de `characters` (inserta nuevos, actualiza nombre/facción de
   los que ya existían).
3. Inserta un `character_snapshot` nuevo por cada entrada del leaderboard —
   **siempre INSERT, nunca UPDATE**, coherente con el modelo append-only.
4. Al final, calcula y muestra la primera distribución real de rating por
   bucket de 200, con el nivel de confianza (High/Medium/Low) tal como
   define la sección 13.4 del plan — esto es literalmente el primer dato
   real para decidir si el rango 1500-2200 tiene muestra suficiente.

**Nota sobre coverage ya observada (con los datos de tu primera descarga):**
Frost Mage tenía un corte de top-5.000 en 1854 de rating — es decir, el
leaderboard solo, sin acumulación por búsqueda de usuario, **no cubre**
1500-1854 para esa spec. Cuando corras la distribución, presta atención a
qué buckets caen en "Low/Insufficient" — eso confirma o descarta si hace
falta adelantar la estrategia de acumulación por búsqueda (sección 12 del
plan) antes de seguir.

