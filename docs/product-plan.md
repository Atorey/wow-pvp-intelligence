# WoW PvP Intelligence — Plan de Producto Completo
### Plataforma web de analítica PvP para World of Warcraft — sin addon, población → contexto → comparación → progresión

*Documento de estrategia de producto. Etiquetas usadas en todo el texto: **[FACT]** dato verificado con fuente, **[HYPOTHESIS]** hipótesis de producto a validar, **[ASSUMPTION]** supuesto de trabajo no verificado, **[UNKNOWN]** dato que no sabemos y que debe validarse antes de construir sobre él, **[DECISION]** decisión tomada para este plan.*

---

# 1. Executive Summary

Vamos a construir una plataforma web PvP-only para World of Warcraft que responde una pregunta que ninguno de los competidores actuales responde de forma directa: **"¿qué diferencia a mi personaje de los jugadores que están justo por encima de mí?"**.

No es otro leaderboard, no es otro checker de rating, no es otra base de datos de builds. Es una capa de **comparación estadística entre segmentos de rating** construida encima de datos que sí podemos obtener de forma fiable: personaje, rating, bracket, gear, y (con reservas, ver sección 31) talentos — todo vía la API oficial de Blizzard, sin addon, sin scraping agresivo.

**[DECISION]** El producto se llama internamente *Player Gap Engine*. La funcionalidad insignia, "Player Gap" / "Road to 2200", es el corazón del MVP y el moat inicial del producto: nadie en el panorama competitivo actual construye una comparación segmentada por rating con significancia estadística explícita.

**[DECISION]** El MVP cubre una sola modalidad (**Solo Shuffle**) y una sola región al lanzar, porque es la modalidad con la relación señal/ruido más alta para este tipo de análisis (ver sección 7).

**[FACT]** La competencia (Murlok, Drustvar, Seramate, Check-PvP, PvPLeaderboard) ya resuelve bien "¿qué build es popular?" y "¿dónde estoy en el ranking?". Ninguno de ellos, a fecha de esta investigación (agosto 2026), ofrece una comparación explícita "tú vs. el siguiente segmento de rating" con nivel de confianza estadística declarado. Ese es el espacio en blanco.

Lo que este documento NO es: una lista de funcionalidades. Es un documento de decisiones, con lo que sabemos, lo que asumimos, y lo que queda por validar antes de escribir la primera línea de código de producción.

---

# 2. Product Vision

> **Population → Context → Comparison → Progression**

La visión a 3 años: convertirnos en la capa de inteligencia de datos del PvP de WoW — el sitio al que un jugador rated de 1500-2400 acude no para ver *qué* está pasando en el meta (eso ya lo resuelven bien otros), sino para entender **qué le separa a él, específicamente, del siguiente escalón**.

Un producto de datos de población PvP, con una capa de comparación individualizada encima, que a medio plazo pueda extenderse (no en el día 1) a más modalidades, más idiomas, y eventualmente a recomendaciones más sofisticadas — siempre manteniendo la disciplina de "correlación, no causalidad" como principio de marca.

---

# 3. Problem Statement

**[HYPOTHESIS]** El problema no es falta de datos. Es falta de **contexto accionable e individualizado**.

Un jugador de 1840 CR en Solo Shuffle Frost Mage hoy puede:
- Ver el ranking global (Blizzard, PvPLeaderboard, Seramate, Drustvar, Check-PvP).
- Ver qué build llevan "los mejores" Frost Mage — normalmente el top 50-100 (Murlok, PvPLeaderboard).
- Ver su propio histórico de rating (Check-PvP, Seramate, Arenatracker).
- Ver representación de spec en el meta (Drustvar, Seramate, PvPLeaderboard).

Lo que **no puede hacer en ningún sitio hoy**: pedir "compárame específicamente contra jugadores de mi misma spec en el segmento 2000-2200" y recibir una respuesta que distinga (a) diferencias reales y estadísticamente relevantes de (b) ruido, con tamaño de muestra declarado.

El "top 50-100" que muestran hoy las herramientas de builds no es el segmento relevante para un jugador de 1840 — es el segmento para alguien que ya está en 2400+. Comparar a un jugador de 1840 contra el build del top 100 es comparar peras con manzanas: la diferencia de rating es tan grande que casi cualquier variable "parece" importar, cuando en realidad muchas no son alcanzables o relevantes en su propio segmento.

---

# 4. Target Users

**[HYPOTHESIS]** — segmentación a validar con datos reales de distribución de población (ver sección 31, punto UNKNOWN sobre distribución completa).

## ICP (Ideal Customer Profile)
Jugador de WoW retail que juega PvP rated de forma regular (Solo Shuffle principalmente), rating actual entre **1400 y 2200 CR**, activo semanalmente, que consulta contenido de build/meta al menos una vez por semana en otra fuente (Wowhead, Icy Veins, Murlok, YouTube, Discord).

## Primary Persona — "El que quiere subir de tier"
- Rating: 1500–2100 CR Solo Shuffle.
- Juega 3-5 sesiones/semana.
- Ya consume contenido de build pero no sabe *cuál de las variables que ve realmente aplica a su nivel*.
- Pain: "leo guías para 2400+ y no sé qué de eso me sirve a mí ahora mismo".
- Trigger: acaba de perder rating o se ha estancado varias semanas en el mismo rango.
- Frecuencia de uso esperada: 2-4 veces/semana, picos tras sesiones de juego.

## Secondary Persona A — "El curioso de datos/meta"
- Rating: variable, incluso 2400+.
- Le interesa el meta en sí, no solo su progresión personal (early adopter de tendencias, comps, FOTM).
- Consume la sección de Meta/Trends más que Player Gap.

## Secondary Persona B — "El creador de contenido / coach"
- Streamers, coaches, escritores de guías.
- Usa la plataforma como fuente de datos para su propio contenido.
- Bajo volumen pero alto valor de distribución (linkbacks, menciones).

## Anti-Personas
- Jugador Rank 1 / profesional de torneo: ya tiene sus propias herramientas (WarcraftLogs-equivalentes, coach personal, replays). El "gap" no le aporta nada porque no hay segmento "por encima" con datos suficientes.
- Jugador exclusivamente PvE: fuera de alcance por diseño (sección 1).
- Jugador completamente casual sin PvP rated: no genera el dato de entrada (rating) que necesita el producto para funcionar.

## Jobs To Be Done (JTBD)
| # | Job | Contexto |
|---|---|---|
| 1 | "Cuando llevo varias semanas estancado en mi rating, quiero saber qué es objetivamente distinto entre mi personaje y los que están un escalón por encima, para decidir qué probar." | Trigger: plateau |
| 2 | "Cuando empiezo temporada, quiero saber rápido si mi build de temporada pasada sigue siendo válida en mi rango." | Trigger: inicio de season |
| 3 | "Cuando veo una build viral en redes/Discord, quiero saber si de verdad la está usando gente en mi rango o solo el top 0.1%." | Trigger: contenido externo |
| 4 | "Cuando pierdo varias partidas seguidas, quiero un check rápido de si mi gear/gemas/encantamientos están al día." | Trigger: racha negativa |
| 5 | "Cuando juego una spec menos común, quiero saber si soy parte de una tendencia de crecimiento o si estoy jugando algo marginal sin apenas datos de referencia." | Trigger: curiosidad/duda |

## Pains / Gains
- **Pains**: exceso de contenido genérico ("tier list" sin contexto de rango), falta de confianza en si un cambio realmente ayuda, dificultad para comparar de forma justa (mismo bracket, misma spec, rango de rating similar).
- **Gains**: sensación de progreso objetivo, ahorro de tiempo de investigación, confianza basada en datos y no en opinión de Discord.

---

# 5. Competitive Landscape

**[FACT]** Investigación realizada en agosto de 2026 directamente sobre los sitios y sus propias páginas de comparación pública.

## A. Panorama competitivo (resumen por producto)

| Producto | Qué resuelve bien | Fuente de datos | Addon requerido |
|---|---|---|---|
| **Murlok.io** | Builds de los mejores jugadores por spec (M+ y PvP), import de talentos, gear BiS por rango alto | Web (perfil), con addon complementario *MurlokExport* que muestra los datos de Murlok dentro del juego <sup>[FACT]</sup> | No para la web; sí para ver los datos in-game |
| **Drustvar** | Leaderboards, tier lists, LFG, guías de spec auto-generadas, Character Audit (beta) comparando gear/enchants contra top players, blue post tracker, M+ | Web + addon propio (*Drustvar.com PVP Ratings*) que muestra rating en tooltips LFG usando una base local descargada <sup>[FACT]</sup> | No para navegar el sitio; sí para el add-on de tooltips LFG |
| **Seramate** | Ladder <1 min de refresco, SeraChat (IA conversacional sobre perfiles), búsqueda en lenguaje natural, historial de partidas por personaje, Arena Archives desde TBC S1, multiclasser detection | Web + addon opcional (*Seramate PvP Inspect*) | No |
| **Check-PvP** | Histórico de rating, fechas de logros, rating pico, personajes alternativos, búsqueda rápida | Web | No |
| **PvPLeaderboard** | Filtrado de leaderboard por clase/spec/raza/facción, qué talentos eligen los mejores | Web (usa el límite de profundidad de la API de Blizzard: **top 5.000 por bracket, incluido Solo Shuffle y BG Blitz** <sup>[FACT]</sup>) | No |
| **PvPLog** (histórico) | Registro de victorias/derrotas y encuentros con otros jugadores | Era un **addon** clásico de registro local, no una web de analítica de población <sup>[FACT]</sup> — el "PvPLogs" moderno (wowpvplogs.com) también es addon-first, capturando scoreboard completo (daño, healing, kills) que **no está disponible vía API pública** | Sí, addon-first |

## B. Feature matrix (comparativa condensada, basada en las propias páginas de comparación de Seramate)

| Feature | Murlok | Drustvar | Seramate | Check-PvP | PvPLeaderboard | **Nuestro producto (propuesta)** |
|---|---|---|---|---|---|---|
| Leaderboard / ladder | ✓ | ✓ (5+ min refresco) | ✓ (<1 min) | ✓ (~5 min) | ✓ | ✓ (no es el foco) |
| Builds top players | ✓ (fuerte) | ✓ | parcial | – | ✓ (talentos) | ✓ (contexto, no el fin) |
| Histórico de rating | parcial | ✓ | ✓ (gráfico) | ✓ (fuerte) | – | ✓ |
| **Comparación segmentada por rango de rating** | – | parcial (Character Audit vs. *top* players, no vs. siguiente segmento) | – | – | – | **✓ — núcleo del producto** |
| IA conversacional | – | – | ✓ (SeraChat) | – | – | No en MVP (ver sección 6) |
| Guías auto-generadas | – | ✓ | ✓ | – | – | No en MVP |
| LFG | – | ✓ | – | (parcial, histórico) | – | Fuera de alcance |
| SEO programático por spec/bracket/rating | parcial | ✓ | ✓ | parcial | ✓ | ✓ (diseño propio, sección 23) |

## C. Positioning map (dos ejes: "Amplitud de producto" vs. "Profundidad de contexto individual")

```
                     ALTA profundidad de contexto individual
                                     │
                                     │        ★ NOSOTROS
                                     │        (Player Gap)
                                     │
      Drustvar (Character Audit)    │
                    ●                │
                                     │
BAJA amplitud ───────────────────────┼─────────────────────── ALTA amplitud
(solo PvP)                          │                         (PvP+PvE+social+IA)
                                     │
        Check-PvP ●                 │           ● Seramate
     (histórico simple)             │       (amplio: IA, LFG, PvE, social)
                                     │
                     Murlok ●        │  ● PvPLeaderboard
                (builds top)         │   (filtros de ladder)
                                     │
                     BAJA profundidad de contexto individual
```

**[HYPOTHESIS]** El espacio en blanco (white space) está arriba a la izquierda: máxima profundidad de contexto individual, amplitud deliberadamente contenida (PvP-only, sin LFG, sin IA de entrada).

## D. Jobs-to-be-done comparison

| JTBD | Mejor resuelto hoy por | Gap |
|---|---|---|
| "¿Dónde estoy en la ladder?" | Blizzard, PvPLeaderboard, Seramate | Resuelto |
| "¿Qué build usan los mejores?" | Murlok, PvPLeaderboard | Resuelto (pero para rangos altos) |
| "¿Cómo he evolucionado?" | Check-PvP, Seramate | Resuelto |
| "¿Qué me separa del siguiente escalón, específicamente a mí?" | **Nadie** | **Gap real** |
| "¿Es esta build viral realmente popular en mi rango?" | Nadie de forma directa | Gap real |

## E–F. Fortalezas / Debilidades / White spaces

| | Fortaleza | Debilidad |
|---|---|---|
| Murlok | Referencia de builds de gama alta, addon con tracción (>1,2M descargas <sup>[FACT]</sup>) | Sin contexto por rango, sin comparación individual |
| Drustvar | Amplitud de features (guías, tier list, LFG, blue posts), Character Audit ya apunta a nuestra idea | Refresco de ladder más lento (5+min vs <1min de Seramate), audit compara contra el top, no contra "tu siguiente escalón" |
| Seramate | Velocidad de refresco, IA conversacional, UX cuidada, archivo histórico profundo (desde TBC S1) | Sin comparación segmentada por rating; amplitud (PvE, IA general) diluye el foco PvP puro |
| Check-PvP | Simplicidad, fuerte en histórico/logros | Perfil "básico" según su propia comparación con Seramate; sin analítica de builds |
| PvPLeaderboard | Filtros de ladder por talento/raza/facción sólidos | UX/visual menos cuidada, sin narrativa de progresión |

**White spaces confirmados:**
1. Comparación estadística segmentada por rating (ninguno lo hace).
2. Comunicación explícita de incertidumbre/confianza estadística (ninguno lo hace).
3. Narrativa de producto centrada en "tu progreso", no en "el ranking global".

## G–I. Qué hacer igual / qué mejorar / qué NO competir

**[DECISION]**
- **Hacer igual que la competencia**: rapidez de refresco del ladder (Seramate marca el estándar en <1 min — aunque el techo real lo pone Blizzard, que publica el leaderboard cada ~3h aprox. <sup>[FACT, fuente: Seramate FAQ]</sup>, así que "velocidad" compite en *distribución* del dato, no en frescura real de origen), UX limpia sin exceso de anuncios, cobertura de Solo Shuffle y Blitz.
- **Mejorar**: comparación con contexto de rango (nuestro core), comunicación de incertidumbre, foco editorial (menos ruido de features).
- **NO competir de frente en**: LFG (Drustvar), IA conversacional general tipo "chatbot" (Seramate — coste de desarrollo alto, valor diferencial dudoso para nuestro ICP en el día 1), cobertura M+/PvE (Drustvar, Seramate), profundidad de archivo histórico completo multi-expansión (Seramate ya tiene ventaja de años ahí).

## J. Qué adaptar de LoL (OP.GG / Mobalytics / U.GG / Blitz / League of Graphs)

| Concepto de LoL | ¿Aplica a WoW PvP? | Cómo |
|---|---|---|
| Separar por elo/rango | **Sí — es literalmente nuestra idea central** | Segmentos de rating, no "elo" pero el concepto es idéntico |
| Separar por posición/rol | Parcial | En WoW el equivalente es spec, ya cubierto por todos |
| Comparar jugador vs. jugador | Sí | Feature MVP+ (sección 6) |
| Detectar counters | **No en MVP** — requiere datos de partida (quién jugó contra quién y ganó), que no tenemos sin addon (ver sección 8) | Marcar como V2/V3 condicionado a validar fuente de datos |
| Detectar sinergias/comps | Parcial, limitado | Solo representación de comps (quién juega con quién no es observable sin match data), no winrate de comp |
| Power spikes | No aplica directamente (no hay "curva de partida" observable sin combat log) | Descartar |
| Recomendaciones personalizadas | Sí, con matices | Como "diferencias observadas", nunca como "deberías hacer X" (principio 3, sección 10) |
| Winrate por build | **No fiable sin match data** | No en MVP; marcar UNKNOWN/TO VALIDATE si aparece fuente fiable en el futuro |

---

# 6. Market Opportunity

**[UNKNOWN]** Blizzard no publica cifras de suscriptores ni de jugadores activos de PvP rated por bracket/región. Cualquier cifra de "tamaño de población PvP" que veamos en foros o terceros es una estimación no oficial.

**[FACT]** Lo único cuantificable de forma fiable sin datos propios: el límite de profundidad de leaderboard expuesto por la API de Blizzard es **5.000 jugadores por bracket** (confirmado por PvPLeaderboard: "top 5000 players as that is the maximum depth returned by Blizzard's API for each bracket's leaderboard — including for Solo Shuffle and BG Blitz, donde cada especialización tiene su propio leaderboard"). Esto significa que **no podemos observar directamente a toda la población PvP vía leaderboard** — solo el top 5.000 *por spec* en Solo Shuffle/Blitz, y top 5.000 general en 2v2/3v3/RBG.

**[ASSUMPTION]** La población real que juega PvP rated por debajo del corte de 5.000 (es decir, la gran mayoría de nuestro ICP, 1400-2200 CR) es sustancialmente mayor que el propio top 5.000 — pero solo es observable de forma indirecta, por ejemplo cuando un jugador usa nuestra "búsqueda de personaje" y su ficha entra a nuestra base de datos (mismo patrón que usa Drustvar para su addon, "según usan la función de check rating en la web, se añaden nuevos jugadores a la base de datos" <sup>[FACT]</sup>).

**[DECISION]** Esto tiene una consecuencia de diseño crítica: nuestra "población" para calcular percentiles y comparaciones **no puede depender solo del leaderboard top 5.000**. Debe construirse de forma acumulativa a partir de: (1) el leaderboard top 5.000 por spec como semilla, y (2) cada búsqueda de personaje que un usuario realiza en nuestra plataforma, que añade ese personaje a nuestro dataset propio (igual que hace Drustvar). Ver sección 9 y sección 31.

**Validación de mercado pendiente [UNKNOWN — necesita investigación propia, no cubierto por búsqueda web genérica]:**
- Tráfico mensual real de Murlok, Drustvar, Seramate, Check-PvP, PvPLeaderboard (herramientas tipo Ahrefs/Similarweb, no verificado en esta pasada).
- Volumen de búsqueda mensual de términos long-tail tipo "frost mage solo shuffle build", "[clase] pvp guide [rating]".
- Willingness to pay del segmento 1500-2200 CR.

---

# 7. Product Positioning

**Posicionamiento propuesto: "WoW PvP Intelligence"**

**[HYPOTHESIS]** Es un buen punto de partida pero genérico — "intelligence" no comunica el diferencial concreto (comparación por segmento) y puede sonar a "otra base de datos con IA".

**Alternativas evaluadas:**

| Naming | Pros | Contras |
|---|---|---|
| WoW PvP Intelligence | Suena profesional, extensible | Genérico, no diferencia del resto |
| Player Gap | Comunica directamente el core feature | Puede sonar negativo/técnico si no se explica bien |
| Rating Context / RatingContext | Explica el "contexto" central | Poco memorable como marca |
| [Nombre propio] + tagline "See what separates you from the players above you" | Tagline hace el trabajo pesado, el nombre puede ser corto y memorable | Requiere invertir en el nombre por separado |

**[DECISION]** Recomendación: nombre de marca corto y memorable (a definir en fase de branding, fuera de alcance de este documento), con tagline funcional:

> **"See what separates you from the players above you."**

Este tagline cumple los criterios que pide el documento: no es "otro ranking", no es "otra guía de builds", comunica comparación + progresión en una frase. Evitar cualquier naming que empiece por "Pvp-" o contenga "-log"/"-tracker" genérico — ese espacio de naming ya está saturado (PvPLog, PvPLeaderboard, Check-PvP, Arenatracker, RatedTracker...).

**Categoría a evocar**: no "otra web de rankings", sino la primera herramienta de **"rating context"** o **"segment comparison"** para WoW PvP — un concepto de categoría nuevo, igual que Mobalytics no se posicionó como "otra web de builds de LoL" sino como "tu coach de datos".

---

# 8. Value Proposition

**Propuesta de valor principal:**

> No te decimos qué build es "la mejor". Te decimos, con datos, qué es objetivamente distinto entre tu personaje y los jugadores que están justo por encima de ti — para que decidas tú qué probar.

**Sub-propuestas por audiencia:**
- Para el jugador 1500-2200: "deja de adivinar qué cambiar — compárate con el segmento al que realmente aspiras, no con el top 0.1%".
- Para el curioso de datos: "el meta de WoW PvP, medido por actividad real, no por opinión de Discord".
- Para el creador de contenido: "datos de población citables, actualizados, con metodología transparente".

---

# 9. Product Principles

**[DECISION]** Principios finales (versión propia, no genérica):

1. **Contexto antes que ranking absoluto.** Un número sin el segmento de comparación correcto es ruido.
2. **Correlación, nunca causalidad implícita.** Nunca decimos "esto te hará subir"; decimos "esto es lo que hace el X% del siguiente segmento".
3. **Incertidumbre visible, no oculta.** Todo insight lleva tamaño de muestra y nivel de confianza. Si la muestra es insuficiente, lo decimos en vez de rellenar con una cifra poco fiable.
4. **Jugador activo por encima de cuenta histórica.** Un 2400 de hace 8 meses no compite en igualdad de condiciones con un 2400 activo esta semana en nuestras comparaciones.
5. **Explicar, no dictar.** Progressive disclosure: mostramos el "qué", dejamos que el jugador decida el "y ahora qué".
6. **Sin funcionalidades de relleno.** Si una feature no ayuda a responder "¿qué me separa del siguiente escalón?", no entra en el roadmap solo por paridad competitiva.
7. **IA solo donde hay valor probado, nunca por defecto.** (Ver sección 6, decisión de no incluir IA conversacional en el MVP.)
8. **Cada insight debe ser trazable a un dato concreto.** Nada de "score" opaco sin desglose.
9. **Rápido primero, bonito después.** Un profile que tarda en cargar pierde al usuario antes de demostrar valor.
10. **SEO como canal, no como producto.** No generamos páginas sin contenido único solo para indexar (ver sección 23).
11. **Mobile-friendly de partida**, no como migración posterior — nuestro ICP consulta esto entre partidas, a menudo desde el móvil.
12. **No competir en amplitud con quien ya ganó esa batalla.** Preferimos ser profundos en una cosa (comparación por segmento) que amplios en diez.

---

# 10. Core Product

El producto se organiza alrededor de un único recorrido conceptual:

```
   PLAYER  →  CONTEXT  →  COMPARISON  →  INSIGHT  →  PROGRESSION
     │            │             │            │             │
  busco mi    ¿dónde estoy   ¿qué me      diferencias   ¿ha cambiado
  personaje   realmente,     separa del   concretas,    algo en las
              con qué        siguiente    con % y       últimas
              población      segmento?    confianza     semanas?
              comparo?
```

Todo lo demás (meta analytics, trends, builds, gear) existe para **alimentar** este recorrido con contexto de calidad, no como secciones independientes sin relación entre sí.

---

# 11. Player Profile

**Datos a mostrar (etiquetados por viabilidad — detalle completo en sección 31):**

| Campo | Viabilidad |
|---|---|
| Nombre, reino, región, clase, spec | [FACT] disponible vía Character Profile API |
| Rating actual por bracket (2v2, 3v3, RBG, Shuffle por spec, Blitz) | [FACT] vía `pvp-bracket-statistics`, confirmado incluso el formato de bracket para Shuffle (`shuffle-{clase}-{spec}`) |
| Season match statistics (jugadas/ganadas/perdidas) | [FACT] confirmado en respuesta real de la API (`season_match_statistics: {played, won, lost}`) |
| Rating pico / histórico de temporada | [ASSUMPTION] la API da el estado actual, no el histórico completo — el histórico hay que construirlo nosotros vía snapshots propios (sección 9 del documento, modelo de datos) |
| Gear equipado (ilvl, items, gemas, encantamientos) | [FACT] vía Character Equipment Summary — ver matriz completa sección 31 |
| Talentos (class/spec/hero talents, loadout) | **[UNKNOWN / RIESGO ACTIVO]** — el campo `loadouts` del endpoint de especializaciones **desapareció tras el parche 11.2 (agosto 2025)** según múltiples reportes en el foro oficial de Blizzard, con desarrolladores de terceros ("muchos dependen de sitios como Murlok...") confirmando el impacto. No tenemos confirmación de que esté resuelto de forma estable a fecha de este documento — **debe validarse en Sprint 0 antes de comprometer la feature de comparación de talentos** |
| Percentil / ranking | [DECISION] calculado por nosotros, no proporcionado por Blizzard tal cual |
| Actividad reciente (last seen, partidas recientes) | [ASSUMPTION] aproximable por frecuencia de actualización de `season_match_statistics.played` entre snapshots nuestros, no es un campo directo de "last seen" en la API |
| Datos de partida individual (daño, healing, kills, ganador, MMR exacto por partida) | **[FACT — NO DISPONIBLE]** sin addon. Confirmado por el hecho de que herramientas como *PvPLogs* o *RatedTracker* necesitan un addon in-game precisamente porque ese nivel de detalle no lo expone la API pública |

---

# 12. Population Analytics

**[DECISION]** La "población" no es un concepto único — hay tres capas, y hay que ser explícito sobre cuál se usa en cada pantalla:

1. **Población observada por leaderboard** — el top 5.000 por bracket/spec expuesto por la API dinámica de Blizzard. Alta fiabilidad, cobertura limitada a la parte alta de la distribución.
2. **Población acumulada propia** — todo personaje que ha sido consultado (por nosotros vía snapshot batch, o por un usuario que lo buscó) y que entra a nuestra base de datos histórica. Cobertura potencialmente mucho mayor en el rango medio (1400-2000), pero con sesgo de muestreo: solo entran personajes que alguien buscó o que estuvieron en un leaderboard en algún momento.
3. **Población activa** — subconjunto de (1)+(2) filtrado por actividad reciente (ver sección 9, "Active Players").

**[HYPOTHESIS]** Para el MVP, comparar contra la población (1) es insuficiente para el ICP 1500-2200 porque ese rango normalmente está *fuera* del top 5.000 de muchas specs. La estrategia de "sembrar" la base de datos con snapshots periódicos + acumulación por búsqueda de usuario (como hace Drustvar) es **necesaria, no opcional**, para que Player Gap tenga sentido fuera del top de la ladder.

---

# 13. Player Gap

Esta es la funcionalidad central del producto. Se desarrolla en profundidad.

## 13.1 Concepto

Dado un personaje con rating **R** en spec **S** y bracket **B**, comparamos su build/gear/stats contra la distribución de jugadores de la misma spec y bracket en el **segmento de rating inmediatamente superior** (y, opcionalmente, contra su propio segmento actual, para mostrar si ya está alineado con sus pares).

```
EJEMPLO

Frost Mage · Solo Shuffle · 1840 CR

TU SEGMENTO          SIGUIENTE SEGMENTO
1800 – 2000    →      2000 – 2200

┌─────────────────────────────────────────┐
│  WHAT SEPARATES YOU FROM 2000+?          │
│                                           │
│  Talents        ▓▓▓▓▓▓▓░░░  74% aligned  │
│  Gear           ▓▓▓▓▓▓▓▓▓░  88% aligned  │
│  Stats          ▓▓▓▓▓▓▓▓▓▓  91% aligned  │
│  Embellishments ▓▓▓▓▓▓░░░░  62% aligned  │
│                                           │
│  Biggest differences (n=312 in 2000-2200,│
│  confidence: high):                      │
│  1. Talent: Ice Caller — 81% vs 47%      │
│  2. Trinket: X — 66% vs 29%              │
│  3. Secondary stat priority: Haste>Crit  │
│     in 74% of 2000-2200 vs 41% here      │
│                                           │
│  "This does not mean changing these      │
│   will raise your rating."               │
└─────────────────────────────────────────┘
```

## 13.2 Fórmula y scoring

**[DECISION]** Para cada variable comparable (talento individual, item, gema, encantamiento, prioridad de stat secundaria), calculamos:

```
adoption_rate(segment, variable) = 
    (nº de personajes activos en el segmento que usan esa variable) 
    / (nº total de personajes activos en el segmento)
```

**Alignment score** (el "% aligned" del ejemplo) para una categoría (p.ej. "Talents"):

```
alignment_score = 1 - (distancia_ponderada entre el vector de elección 
                        del jugador y el vector de adopción mayoritaria 
                        del segmento objetivo)
```

Donde la distancia pondera más los nodos de talento con mayor "poder discriminante" (ver 13.3) y menos los que están cerca del 50/50 en todos los segmentos (esos no discriminan nada, son ruido).

**Biggest differences** = las variables con mayor `|adoption_rate(mi_segmento) - adoption_rate(siguiente_segmento)|`, ordenadas de mayor a menor, filtradas por tamaño de muestra mínimo (13.4).

## 13.3 Poder discriminante (para evitar ruido)

**[DECISION]** No todas las diferencias importan igual. Una variable que el 95% de la gente usa en *todos* los segmentos (p.ej. un talento "obligatorio" del árbol) no aporta información — no discrimina entre segmentos. Definimos:

```
discriminative_power(variable) = varianza de adoption_rate(variable) 
                                   entre segmentos consecutivos
```

Solo mostramos como "biggest differences" variables con `discriminative_power` por encima de un umbral mínimo — evita el falso insight de "el 99% usa X" cuando X es simplemente estándar en toda la spec.

## 13.4 Confidence y minimum sample size

**[DECISION]**

| Nivel de confianza | Condición | Qué se muestra |
|---|---|---|
| High | n ≥ 100 activos en el segmento objetivo, para esa spec/bracket | Insight completo, con % |
| Medium | 30 ≤ n < 100 | Insight con aviso visible "muestra reducida" |
| Low / Insufficient | n < 30 | **No se muestra la comparación** — mensaje explícito: "No hay suficientes jugadores activos en este segmento todavía para una comparación fiable." |

Esto es deliberadamente conservador y es coherente con el principio 3 (sección 9): preferimos no mostrar nada antes que mostrar un dato poco fiable disfrazado de insight.

## 13.5 Evitar conclusiones engañosas

**[DECISION] — reglas de producto, no solo de copywriting:**
- Nunca usar lenguaje causal ("esto te subirá de rating", "cambia X para ganar más").
- Siempre mostrar el tamaño de muestra junto al porcentaje, no en un tooltip escondido.
- Cuando dos variables están correlacionadas entre sí (p. ej. un talento que solo tiene sentido con cierto trinket), no presentarlas como recomendaciones independientes — señalar la relación si es detectable.
- Nunca comparar contra el top 100 global como "el objetivo" por defecto — eso es precisamente el error que comete la categoría hoy (sección 3). El objetivo por defecto es siempre el **siguiente segmento**, no la cima.
- Diferencias estadísticamente pequeñas (por debajo del umbral de poder discriminante) se ocultan, no se muestran "por completitud".

## 13.6 De datos a insight (sin caer en recomendación falsa)

Formato de insight recomendado (plantilla fija, no generación libre de texto en el MVP para evitar alucinación de causalidad):

> **"{Variable} is used by {X}% of active players in the {segmento objetivo} segment vs. {Y}% in your segment ({bracket}, {spec}, n={muestra})."**

Sin verbo de recomendación. El jugador saca su propia conclusión — coherente con el principio "explicar, no dictar".

---

# 14. Rating / Percentile System

**[DECISION]** Distinguimos explícitamente:

| Concepto | Definición |
|---|---|
| **Current rating** | El valor que devuelve la API en el momento de la consulta/snapshot |
| **Peak rating** | El máximo observado en nuestros propios snapshots durante la temporada — **no** es un campo nativo de la API, lo construimos nosotros a partir del histórico de snapshots (ver sección 21) |
| **Historical rating** | Serie temporal completa de snapshots propios |
| **Active rating** | Current rating, pero solo se usa en cálculos de percentil/comparación si el personaje cumple criterio de "activo" (sección 9) |
| **Percentile / rank** | Calculado por nosotros sobre nuestra población acumulada (sección 12), **no** es el percentil "real" de toda la población de WoW — debe comunicarse como tal |

**[DECISION]** Comunicación de incertidumbre: cuando mostremos "Top 28%", debe ir acompañado de una nota de metodología accesible (tooltip/página de metodología) del tipo: *"Calculado sobre N personajes activos observados por [Producto] en los últimos 30 días para esta spec y bracket. No representa el 100% de la población de WoW, ya que Blizzard no expone esa cifra completa — ver sección 6/31 de este documento para la limitación de origen."*

**[DECISION]** Limitación explícita a comunicar en la propia UI: el leaderboard de Blizzard tiene un tope de 5.000 personajes por bracket/spec — cualquier percentil "top X%" fuera de ese tope se apoya en nuestra población acumulada propia, que es una muestra, no el universo completo.

---

# 15. Build Analytics

**[DECISION]** Clasificación por prioridad (ver también sección 27 para la tabla completa):
- **Core MVP**: build más popular por spec, segmentado por rango de rating (no solo "top players" global — este es el error que comete gran parte de la competencia).
- **MVP+**: evolución de la build más popular a lo largo de la temporada.
- **V2**: comparación lado a lado de dos builds.

**[HYPOTHESIS]** El valor diferencial no está en "mostrar la build top", que ya hacen bien Murlok y PvPLeaderboard — está en mostrarla **segmentada por rating**, algo que hoy nadie hace de forma sistemática (Drustvar y Seramate muestran tier lists/spec stats generales, no desglose fino por bracket de rating).

# 16. Gear Analytics

Mismo principio que builds: ítems/trinkets/gemas/encantamientos más usados, **segmentados por rango de rating y spec**, no solo "top players".

**[DECISION] Core MVP**: adoption rate de gear por segmento (alimenta directamente Player Gap, sección 13).
**V2**: evolución de adoption rate de un ítem concreto a lo largo del tiempo (útil tras cambios de balance/nuevo loot).

# 17. Meta Analytics

**[DECISION]** Explícitamente NO una tier list estática. Fórmula conceptual:

```
meta_signal(spec, bracket, segmento_rating, periodo) = 
    f( representation,                 // % de la población que juega esa spec
       rating_distribution,            // dónde se concentra esa población en la escala de rating
       high_rating_representation,     // % de esa spec en el segmento alto vs. su propia representación general
       activity,                       // volumen de partidas jugadas recientemente
       trend )                         // variación de representation en una ventana de tiempo (7-14 días)
```

Ejemplo de output: *"Spec X has increased 17% among active 2200+ players over the last 14 days."*

**[DECISION] Qué métricas NO usar:**
- Winrate por spec — no disponible de forma fiable sin match data (sección 8/18).
- "Tier" categórico (S/A/B/C) sin desglose — es exactamente lo que queremos evitar (sección 5.I, "qué no competir").

**[DECISION]** Umbral mínimo de muestra para declarar una tendencia: mismo criterio que sección 13.4 (n≥100 = alta confianza; por debajo, no se publica como tendencia, como mucho como "dato preliminar").

**Detección de FOTM vs. tendencia real**: una spec cuya `representation` sube pero cuya `high_rating_representation` NO sube en paralelo es más probablemente ruido de novedad (todo el mundo la prueba tras un buff) que una tendencia consolidada. Solo se marca como "trending" en la UI cuando ambas métricas se mueven en la misma dirección durante ≥2 ventanas de medición consecutivas.

# 18. Composition Analytics

**[DECISION — muy restringido en MVP]**

| Qué podemos calcular con datos disponibles (sin addon) | Qué NO podemos calcular |
|---|---|
| Representación de combinaciones de clase/spec observadas en el mismo equipo, **si** la API expone composición de equipo en algún endpoint agregado (**[UNKNOWN — a validar en Sprint 0]**, no confirmado en esta investigación para 3v3/RBG) | Winrate real de una composición — requeriría saber ganador/perdedor por partida individual, que no está disponible sin addon (confirmado por el hecho de que herramientas de scoreboard como PvPLogs/RatedTracker necesitan addon) |
| Partners frecuentes, **solo si** un jugador ha vinculado sus propias partidas (opt-in, no automático) | Sinergia real medida por resultado — sin match data no hay forma fiable |
| Contadores/"counters" | **Fuera de alcance total en MVP/V2** — requiere match data (quién jugó contra quién y quién ganó) |

**[DECISION]** Esta sección queda deliberadamente pequeña en el MVP. Si en Sprint 0 se confirma que existe un endpoint fiable de composición de equipo agregada, se reevalúa como MVP+; si no, queda en V3/Future condicionado a la eventual introducción de un addon opcional (fuera de alcance del planteamiento "sin addon" inicial, sección 1).

# 19. Trends

**[DECISION] Core MVP**: variación de adoption rate (talentos/gear) entre dos snapshots (semana actual vs. semana anterior), por spec y segmento.
**MVP+**: gráfico de evolución de una variable concreta a lo largo de la temporada.
**V2**: alertas de tendencia emergente (spec/talento que crece de forma sostenida) — sujeto al mismo criterio anti-FOTM de la sección 17.

# 20. Historical Data

Ver modelo de datos completo en sección 28. Resumen funcional:
- Histórico de rating por personaje (serie temporal de snapshots propios).
- Histórico de build (detectar cuándo cambió un talento/gear respecto al snapshot anterior).
- Histórico de meta (representación de spec a lo largo de la temporada).

**[DECISION]** Todo histórico se construye por snapshot incremental nuestro, nunca asumiendo que la API de Blizzard guarda histórico — no lo hace, es un estado actual.

# 21. Search

**[DECISION] Core MVP**: búsqueda de personaje por nombre+reino+región (autocompletado sobre nuestra base acumulada + fallback directo a la API si no existe localmente).
**MVP+**: filtros por spec/bracket/rango de rating sobre nuestras páginas de build/gear/meta.
**V2**: búsqueda combinada (spec + rango + región).
**Future**: búsqueda en lenguaje natural — **[DECISION] explícitamente fuera del MVP**. Es una capacidad que Seramate ya ofrece (AI-Powered Search) con una ventaja de tiempo de mercado; replicarla en el día 1 sin diferenciación clara no es prioritario frente al núcleo de Player Gap. Se revalúa en V2/V3 si el dato de uso lo justifica.

# 22. SEO Strategy

**[DECISION]** Programmatic SEO, pero con reglas estrictas de contenido único para evitar thin content (principio 10, sección 9).

**Plantillas de página con potencial de indexación:**

| Página | Contenido único real | ¿Indexar? |
|---|---|---|
| `/spec/frost-mage` | Resumen de representación, build más popular agregada, tendencia — contenido que cambia y es sustancial | Sí |
| `/spec/frost-mage/solo-shuffle` | Igual, filtrado por bracket — suficientemente distinto del anterior (datos distintos, no solo el mismo texto con una palabra cambiada) | Sí |
| `/spec/frost-mage/solo-shuffle/2000-2200` | Datos de segmento específico — este es precisamente nuestro contenido diferencial, alto valor SEO long-tail | Sí, prioritario |
| `/player/{realm}/{nombre}` | Página de perfil individual — contenido único (datos del jugador) pero volumen de búsqueda por página individual es bajo; útil para long-tail agregado, no para tráfico de cabecera | Sí, pero canonicalizar variantes de capitalización/tildes |
| Combinaciones raza+clase+spec+bracket+rating (miles de combinaciones cruzadas) | Contenido casi idéntico entre combinaciones con poca población | **No indexar** — usar `noindex` o ni generar la página si `n` está por debajo del umbral de confianza (sección 13.4) |

**[DECISION] Reglas anti-thin-content:**
- Página nunca se indexa si el tamaño de muestra subyacente es "Low/Insufficient" (mismo umbral que sección 13.4) — no tiene sentido indexar una página cuyo propio contenido dice "no hay datos suficientes".
- Contenido dinámico (números reales, no texto de relleno) en cada página — nada de párrafos genéricos repetidos con el nombre de la spec sustituido.
- Internal linking: cada página de segmento enlaza al segmento anterior/siguiente (refuerza la narrativa de progresión) y a la página de spec general.
- Actualización de contenido: recalcular al menos semanalmente para que Google detecte cambio real de contenido (no solo fecha de "última actualización" cosmética).

**[DECISION]** SEO es un canal de adquisición, no el objetivo del producto (principio 10). Meta explícita: no depender de Google al >70% del tráfico total a partir del año 1 — diversificar con Discord/Reddit/contenido de creadores desde el Sprint 0 (sección 35).

# 23. UX / User Flows

**Homepage:**
```
"How good are you?"
[ Search your character ]

→ Trending this week: [spec en alza] [talento en alza]
```

**Flujo principal tras búsqueda:**
```
YOUR PVP PROFILE
Rating · Percentile · Spec · Bracket · Activity
        │
        ▼
WHAT SEPARATES YOU FROM 2000+?  ← Player Gap, above the fold
        │
        ▼
Build · Gear · Talents · Stats · Trends  ← detalle progresivo (progressive disclosure)
```

**[DECISION]** Player Gap se muestra **inmediatamente** tras el perfil, no enterrado en una pestaña secundaria — es el producto, no una feature más.

**Onboarding**: cero fricción — sin login obligatorio para la función principal (buscar y ver tu Player Gap), igual que el estándar de la categoría (Check-PvP, Seramate, Drustvar funcionan sin cuenta). Login opcional solo para features de conveniencia (guardar personajes favoritos, notificaciones de cambio de segmento).

**Mobile**: prioridad igual a desktop desde el día 1 (principio 11) — la comparación Player Gap debe caber en una pantalla de móvil sin scroll horizontal ni tablas ilegibles; usar barras de progreso/porcentaje en vez de tablas densas en la vista mobile.

# 24. Information Architecture

**[DECISION]** Arquitectura propuesta (ajustada para SEO + claridad de producto):

```
/
/player/{region}/{realm}/{name}              → perfil + Player Gap
/spec/{spec}-{class}                         → overview de spec (p.ej. frost-mage)
/spec/{spec}-{class}/{bracket}               → overview por bracket
/spec/{spec}-{class}/{bracket}/{rating-range} → página de segmento (alto valor SEO)
/compare/{char1}-vs-{char2}                  → comparación jugador vs jugador (MVP+)
/meta/{bracket}                              → meta analytics
/trends                                      → tendencias generales
/rankings/{bracket}                          → leaderboard tradicional (contexto, no el foco)
/methodology                                 → transparencia de cálculo (percentiles, confianza, fuentes)
```

**[DECISION]** `/methodology` es una página obligatoria desde el MVP, no un "nice to have" — es la que sostiene la credibilidad del principio "correlación, no causalidad" y de la comunicación de incertidumbre.

---

# 25. MVP Scope

**[DECISION] El MVP debe demostrar exactamente 6 cosas (tal como pide el brief), ni más ni menos:**
1. Podemos obtener datos (Blizzard API, sin addon).
2. Podemos construir una población (leaderboard + acumulación por búsqueda).
3. Podemos segmentar esa población por rango de rating.
4. Podemos generar el perfil de un personaje.
5. Podemos generar un Player Gap con confianza declarada.
6. Un grupo real de usuarios (aunque sea pequeño) encuentra valor en ello.

**MVP imprescindible:**
- 1 modalidad: **Solo Shuffle** (ver justificación sección 7 del brief / sección 27 de este documento).
- 1 región para el lanzamiento (US o EU, a decidir por tamaño relativo de comunidad — **[UNKNOWN]**, requiere validación rápida de volumen antes de Sprint 0).
- Player Profile básico.
- Player Gap (talentos + gear, con las reservas de la sección 11 sobre el riesgo del endpoint de talentos).
- Búsqueda de personaje.
- Página de metodología.

**MVP recomendable (si el tiempo lo permite tras lo imprescindible):**
- Build/Gear analytics por segmento como páginas independientes (alimentan Player Gap y dan contenido SEO).
- Trends básico (variación semana a semana).

**Excluido explícitamente del MVP:**
- 2v2/3v3/RBG/Blitz (fase posterior).
- Comparación jugador vs. jugador.
- IA conversacional / búsqueda en lenguaje natural.
- LFG, social, streams.
- Composition analytics más allá de representación básica.
- Multi-región simultánea.
- Cuentas de usuario / login (salvo que se decida meterlo por conveniencia técnica desde ya — no bloquea el valor central).

# 26. Features by Priority

| Feature | Core MVP | MVP+ | V2 | V3 | Future | Never/Avoid |
|---|---|---|---|---|---|---|
| Player Profile (rating, bracket, gear, spec) | ✓ | | | | | |
| Player Gap (talentos + gear vs. siguiente segmento) | ✓ | | | | | |
| Búsqueda de personaje | ✓ | | | | | |
| Página de metodología | ✓ | | | | | |
| Build analytics por segmento | ✓ | | | | | |
| Gear analytics por segmento | ✓ | | | | | |
| Percentil / ranking propio | ✓ | | | | | |
| Trends (semana a semana) | | ✓ | | | | |
| Rating histórico (gráfico) | | ✓ | | | | |
| Meta analytics completo | | ✓ | | | | |
| Comparación jugador vs jugador | | | ✓ | | | |
| Cobertura 2v2/3v3 | | | ✓ | | | |
| Cobertura RBG/Blitz | | | | ✓ | | |
| Multi-región | | | | ✓ | | |
| Composition analytics (representación) | | | | ✓ | | |
| Búsqueda en lenguaje natural | | | | | ✓(revalidar) | |
| Alertas de tendencia / notificaciones | | | | ✓ | | |
| IA conversacional tipo SeraChat | | | | | ✓(revalidar) | |
| LFG | | | | | | ✓ Never |
| Winrate de composición sin match data fiable | | | | | | ✓ Never (a menos que cambie la fuente de datos) |
| Miles de páginas SEO combinatorias sin masa crítica de datos | | | | | | ✓ Never |
| Counters (sin match data) | | | | | | ✓ Never (mismo motivo) |

# 27. Data Architecture

**Entidades principales y relaciones:**

```
Region ──< Realm ──< Character (identidad estable: realm_slug + name_slug + region)
                          │
                          ├──< CharacterSnapshot (N por personaje, uno por cada
                          │      recogida de datos — ESTO es la clave de todo
                          │      el histórico; nunca sobreescribimos, solo
                          │      insertamos snapshots nuevos)
                          │        │
                          │        ├── Build (talentos activos en ese snapshot)
                          │        ├── Gear (lista de Item + Gem + Enchant por slot)
                          │        ├── PvPBracketStat (rating, bracket, season_match_statistics)
                          │        └── Stats (secundarios derivados de gear, si están disponibles)
                          │
Class ──< Spec ──< Talent
Class ──< Spec ──< HeroTalent

PvPSeason ──< PvPBracket ──< PopulationSegment (definido por: season + bracket + spec
                                                 + rango de rating, ej. 2000-2200)
                                    │
                                    └──< AggregateSnapshot (adoption_rate por variable,
                                          calculado periódicamente sobre los
                                          CharacterSnapshot más recientes de cada
                                          Character que cae en ese segmento)

Composition (V3+, opt-in) ──< Character (many-to-many, solo representación)
Trend (derivado, no fuente primaria — se calcula comparando AggregateSnapshot
       consecutivos de un mismo PopulationSegment)
Ranking (vista derivada de CharacterSnapshot + PopulationSegment, no almacenada
         como fuente de verdad, se recalcula)
```

**[DECISION] Principios de modelado:**
- **Nunca sobreescribir.** `CharacterSnapshot` es append-only. El "estado actual" de un personaje es simplemente su snapshot más reciente — el histórico es gratis por diseño.
- **Claves**: `Character` se identifica por `(region, realm_slug, name_slug)` — estable incluso si el personaje cambia de rating/spec. El spec puede cambiar entre snapshots (multiclasser); no asumir que un `Character` siempre tiene el mismo `Spec` activo.
- **Cómo representar cambios de build**: comparar `Build` del snapshot N contra snapshot N-1; si difiere, se marca como "build change event" — esto alimenta tanto el histórico de build (sección 20) como la detección de tendencias (sección 19).
- **Cómo calcular segmentos de rating**: `PopulationSegment` se define con límites configurables (p. ej. buckets de 200 de rating: 1400-1600, 1600-1800...) recalculados por temporada, nunca hardcodeados de forma permanente porque la distribución de rating cambia entre temporadas (soft reset).
- **Cómo calcular percentiles**: sobre el conjunto de `Character` con snapshot "activo" (ver más abajo) dentro del mismo `(season, bracket, spec)` — nunca mezclando specs distintas o temporadas distintas.
- **Cómo evitar contaminar métricas con personajes inactivos**: todo cálculo de `AggregateSnapshot` filtra por `last_active_snapshot_date` dentro de una ventana (ver Active Players abajo) — un `CharacterSnapshot` viejo no entra en el cálculo de adoption_rate del segmento aunque el personaje siga existiendo.

**Active Players — definición operativa:**

| Ventana | Uso |
|---|---|
| **7 días** | Ventana por defecto para "adoption rate" y Player Gap — máxima relevancia del meta actual |
| **14 días** | Ventana alternativa cuando el tamaño de muestra a 7 días es insuficiente (sección 13.4) — trade-off explícito entre frescura y tamaño de muestra |
| **30 días** | Ventana para "season active" (aparece en el ranking de temporada aunque no haya jugado esta semana) |
| **Historical peak** | Fuera de cualquier ventana de actividad — es un dato de archivo, nunca se usa para comparaciones de meta actual |

**[DECISION]** Un personaje que llegó a 2400 hace 8 meses y no ha vuelto a jugar **no cuenta** en el `AggregateSnapshot` del segmento 2200-2400 actual — solo aparece en su propia página de perfil con la etiqueta "peak rating (inactive)".

# 28. Data Pipeline

```
Blizzard API (Game Data + Profile)
        │  (client credentials flow para Game Data;
        │   no se requiere OAuth de usuario para perfiles públicos)
        ▼
   INGESTION  ── jobs programados: (a) leaderboard completo por bracket/spec
        │         cada N horas [alineado a la cadencia real de publicación de
        │         Blizzard, ~3h aprox. según fuentes de terceros, a confirmar
        │         en Sprint 0], (b) refresco bajo demanda cuando un usuario
        │         busca un personaje no visto recientemente
        ▼
  NORMALIZATION ── mapeo a nuestro modelo (Character, Build, Gear...),
        │           validación de esquema, manejo de campos ausentes
        │           (p.ej. loadouts de talentos, ver riesgo sección 11)
        ▼
   STORAGE ── CharacterSnapshot append-only (Postgres)
        ▼
  SNAPSHOT/AGGREGATION ── job periódico (diario para MVP) que recalcula
        │                  PopulationSegment + AggregateSnapshot sobre
        │                  la ventana de actividad vigente
        ▼
   ANALYTICS ── cálculo de Player Gap, percentiles, trends
        ▼
      API interna (backend propio) 
        ▼
     FRONTEND
```

**Frecuencia de actualización [DECISION]:**
- Leaderboard batch: alineado a la cadencia de Blizzard, no más frecuente (no tiene sentido pedir más rápido de lo que la fuente cambia).
- Perfil individual bajo demanda: al buscar, con caché corta (p. ej. 15-30 min) para no golpear el rate limit en búsquedas repetidas del mismo personaje.
- Agregación de segmentos: diaria en MVP; evaluar sub-diaria solo si el volumen de datos y el caso de uso lo justifican (no es necesario para el caso de uso de Player Gap, que no cambia de forma significativa hora a hora).

**Retries / rate limits [FACT]:** límite por defecto de la API de Blizzard confirmado en foros oficiales y de terceros: **100 requests/segundo y 36.000 requests/hora** por client ID (puede ampliarse contactando al equipo de partners, sin garantía). Diseño obligatorio: cola con throttling explícito (no confiar en reintentos reactivos tras 429), y priorización: refresco bajo demanda de usuario > batch de leaderboard > recomputo de agregados.

**Data freshness / calidad [DECISION]:** cada `AggregateSnapshot` almacena `sample_size` y `computed_at`; el frontend nunca muestra un número sin poder trazar de dónde sale y cuándo se calculó (principio 8, sección 9).

# 29. Technical Architecture

**[DECISION] — evitar sobrearquitectura (principio explícito del brief):**

| Capa | Elección | Por qué | Cuándo escalar / qué NO usar todavía |
|---|---|---|---|
| Frontend | Next.js/React | SSR necesario para SEO programático (sección 22); ecosistema maduro | No usar micro-frontends ni monorepo multi-app hasta que haya más de un producto real |
| Backend | Node/TypeScript para API y web; **Python solo para el pipeline de ingestión/analítica** si el equipo tiene ventaja allí (pandas/numpy para los cálculos estadísticos de sección 13) | Compartir tipos entre frontend/backend con TS reduce fricción en equipo pequeño; Python encaja mejor en cálculo estadístico si se prefiere | No dividir en microservicios — monolito modular es suficiente para el volumen de datos del MVP |
| Base de datos | **PostgreSQL** | Relacional encaja bien con el modelo de sección 27; particionado por fecha de snapshot escala razonablemente | ClickHouse/BigQuery **NO en MVP** — solo si el volumen de `CharacterSnapshot` crece a un punto donde las agregaciones analíticas se vuelven lentas en Postgres (referencia orientativa: decenas de millones de filas con consultas analíticas frecuentes) |
| Cache | Redis | Cachear resultados de Player Gap/perfil recientes, reducir presión sobre rate limit de Blizzard | No introducir cache distribuido complejo hasta tener más de una instancia de backend |
| Jobs | Queue simple (p. ej. BullMQ sobre Redis) + cron para batch de leaderboard | Suficiente para la cadencia de actualización descrita en sección 28 | Orquestadores tipo Airflow **no son necesarios** en el MVP — es sobrearquitectura para 2-3 pipelines |
| Infra | Vercel (frontend) + un proveedor simple de contenedores (Railway/Render/Fly, o AWS ECS si el equipo ya conoce AWS) para el backend/jobs | Minimizar ops para equipo pequeño | AWS "completo" (EKS, etc.) solo si el equipo crece y ya hay tracción que lo justifique |
| Analytics de producto | PostHog o Plausible | Necesitamos entender uso real de Player Gap (sección 36), no solo pageviews | GA4 es aceptable pero PostHog da mejor tracking de eventos de producto (uso de Player Gap, no solo visitas) sin coste inicial alto |
| Search (interno) | Búsqueda de personaje: full-text simple de PostgreSQL es suficiente al volumen del MVP | Evitar Elasticsearch/Meilisearch en el día 1 — es más infraestructura de la que el caso de uso (autocompletar nombre de personaje) justifica | Reevaluar si se añade búsqueda en lenguaje natural (Future, sección 21) |

---

# 30. Data Availability / API Feasibility

**Esta es la sección más crítica del documento — determina qué es construible.**

**[FACT general]** Toda la investigación de esta tabla se basa en documentación y foros oficiales de Blizzard/Battle.net y en el comportamiento confirmado de competidores reales que ya operan sin addon (Seramate, Drustvar, Check-PvP, PvPLeaderboard).

| Data point | Available? | Source | Reliability | Update frequency | Cost | Legal/ToS concern | MVP? |
|---|---|---|---|---|---|---|---|
| Personajes (identidad básica) | [FACT] Sí | Character Profile API | Alta | Al consultar / logout del personaje según namespace docs | Gratis (client credentials) | Ninguno conocido, uso estándar documentado | Sí |
| Rating actual por bracket (2v2/3v3/RBG/Shuffle) | [FACT] Sí | `pvp-bracket-statistics` (incl. formato `shuffle-{class}-{spec}` confirmado en foro oficial) | Alta | Actualiza con la actividad del personaje | Gratis | Ninguno | Sí |
| Leaderboards por bracket/spec | [FACT] Sí, limitado a **top 5.000** por bracket/spec | Game Data PvP Leaderboard API | Alta pero con techo de profundidad conocido | ~cada pocas horas (Blizzard-side; Seramate documenta públicamente que Blizzard "publica nuevos datos de leaderboard aproximadamente cada tres horas") | Gratis | Ninguno | Sí |
| Spec / clase | [FACT] Sí | Profile API | Alta | Con el snapshot | Gratis | Ninguno | Sí |
| Gear equipado (items, ilvl) | [FACT] Sí | Character Equipment Summary | Alta | Con el snapshot | Gratis | Ninguno | Sí |
| Gemas / encantamientos | [FACT] Sí, vienen incluidos dentro de Equipment Summary por slot | Character Equipment Summary | Alta | Con el snapshot | Gratis | Ninguno | Sí |
| Talentos (class/spec/hero, loadout completo) | **[UNKNOWN / TO VALIDATE — riesgo activo]** | Character Specializations Summary (`talent_loadout_code`) | **Inestable**: reportado como roto/ausente tras el parche 11.2 (ago. 2025) en múltiples hilos del foro oficial de Blizzard; sin confirmación en esta investigación de que esté resuelto de forma estable a la fecha de este documento (ago. 2026) | Con el snapshot, si funciona | Gratis | Ninguno | **Sí, pero con validación obligatoria en Sprint 0 y plan de contingencia (mostrar "no disponible" en vez de fallar)** |
| Stats secundarios (crit/haste/etc.) | [ASSUMPTION] Derivable del gear equipado (ilvl + stats de cada item), no como campo único directo — a confirmar exactitud del cálculo en Sprint 0 | Character Equipment Summary + tablas de items | Media (depende de exactitud del cálculo propio) | Con el snapshot | Gratis | Ninguno | MVP+ |
| Histórico de rating/build | [FACT — NO lo da la API] Debe construirse con snapshots propios | N/A (propio) | Depende de nuestra cadencia de captura | Nuestra | Coste de almacenamiento propio | Ninguno | Sí (desde el primer snapshot) |
| Actividad / "last seen" | [FACT — NO existe campo directo] Aproximado por cambios en `season_match_statistics.played` entre snapshots propios | N/A (derivado) | Media | Depende de cadencia de snapshot | Nuestra | Ninguno | Sí (aproximado) |
| Composiciones de equipo (quién jugó con quién) | **[UNKNOWN]** No confirmado en esta investigación que exista un endpoint público agregado con esta información para 2v2/3v3/RBG | — | — | — | — | — | No en MVP |
| Datos de partida individual (ganador, daño, healing, kills, MMR exacto por partida) | **[FACT — NO disponible sin addon]** — confirmado indirectamente: herramientas que ofrecen esto (PvPLogs, RatedTracker) son addon-first precisamente porque ese nivel de detalle no está expuesto por la API pública | Requeriría addon/combat log | N/A | N/A | N/A | Fuera de alcance ("sin addon") | No |
| Win/loss por partida | [FACT — NO disponible sin addon] Mismo motivo que arriba (solo se obtiene `won`/`lost` como contador agregado de temporada, no por partida) | `season_match_statistics` (agregado, no por partida) | N/A a nivel partida | N/A | N/A | N/A | No |

**[DECISION] Consecuencia directa de esta tabla**: el MVP se apoya en las filas marcadas [FACT] con fiabilidad Alta, trata la fila de talentos como **riesgo de Sprint 0 número uno** (con UI de fallback si el dato no está disponible para un personaje concreto), y descarta explícitamente cualquier feature que dependa de datos de partida individual hasta que exista una fuente fiable distinta de un addon propio (fuera del alcance de este documento, sección 1).

# 31. Data Quality

**[DECISION] Data Quality Score por cada `AggregateSnapshot`, visible internamente (y de forma simplificada en el frontend vía nivel de confianza, sección 13.4):**

```
quality_score = ponderación de:
  - sample_size (peso alto)
  - recency (antigüedad del snapshot más reciente incluido)
  - % de personajes del segmento con datos completos 
    (p.ej. si el campo de talentos falló para el 40% de la muestra,
     el score de la variable "talents" baja específicamente, aunque
     el de "gear" pueda seguir siendo alto)
  - estabilidad (si el adoption_rate calculado varía de forma extrema
    entre dos cálculos consecutivos con el mismo tamaño de muestra,
    algo anómalo puede estar pasando en la ingesta — señal de alerta interna)
```

Regla de producto: si `quality_score` de una variable concreta cae por debajo del umbral, esa variable se excluye del Player Gap para ese segmento en vez de mostrarse con un dato potencialmente corrupto — coherente con el riesgo activo de talentos (sección 30).

---

# 32. Sprint 0

**Duración: 2 semanas. Objetivo único: demostrar PLAYER → POPULATION → COMPARISON → PLAYER GAP con datos reales, no con una homepage bonita.**

| Día | Tarea | Entregable | Criterio de éxito |
|---|---|---|---|
| 1-2 | Registrar client ID en Battle.net developer portal; probar autenticación client credentials; llamar Character Profile, PvP Bracket Statistics, Equipment Summary, Specializations Summary contra 10 personajes conocidos manualmente | Script de prueba + JSON de ejemplo por endpoint | Los 4 endpoints devuelven datos coherentes para los 10 personajes |
| 2-3 | **Validar específicamente el riesgo de talentos** (sección 30): comprobar si `talent_loadout_code` viene poblado de forma consistente en personajes de distintas clases | Reporte corto: "talentos disponibles: sí/no/parcial, por clase" | Si falla para >20% de las clases probadas, se activa el plan de contingencia (Player Gap sin talentos en el lanzamiento) |
| 3-5 | Descargar leaderboard completo de Solo Shuffle para 3-5 specs (empezar por specs populares, ej. Frost Mage, Restoration Shaman, Fury Warrior) — hasta el tope de 5.000 por spec | Dataset crudo almacenado | Cobertura del top 5.000 confirmada por spec |
| 5-7 | Diseñar y crear schema mínimo de Postgres (`Character`, `CharacterSnapshot`, `Build`, `Gear`, `PvPBracketStat`) e ingerir el dataset del leaderboard | Base de datos poblada | Consultas de agregación (adoption rate por talento/gear) devuelven resultados en <2s sobre el dataset inicial |
| 7-9 | Calcular la primera distribución de rating real por segmentos (buckets de 200) para las specs descargadas | Tabla de distribución | Los segmentos tienen tamaño de muestra suficiente (≥30, idealmente ≥100) al menos en 2-3 buckets centrales |
| 9-11 | Generar la primera comparación Player Gap real (manual/script, no UI todavía) para 3 personajes de prueba en distintos rangos | 3 reportes de ejemplo (JSON o markdown) | El "biggest differences" resultante es coherente con lo que un jugador experto de esa spec reconocería como razonable (validación cualitativa interna) |
| 11-12 | Probar refresco: repetir la descarga de leaderboard 24-48h después y comprobar actualización de rating/gear en los mismos personajes | Comparación snapshot 1 vs snapshot 2 | Se detectan cambios reales (no ceros/errores) en al menos el 90% de los personajes que efectivamente jugaron |
| 12-14 | Medir cobertura: ¿qué % de un rango de rating objetivo (p.ej. 1800-2000 Frost Mage) queda realmente cubierto solo con el leaderboard, sin acumulación por búsqueda? | Reporte de cobertura | Determina si la estrategia de "acumulación por búsqueda de usuario" (sección 12) es imprescindible desde el día 1 o puede esperar a MVP+ |

**Criterio de GO/NO-GO al final de Sprint 0 [DECISION]:**
- **GO** si: los 3 endpoints core (perfil, rating, gear) son fiables al 100% y talentos funciona al menos parcialmente (aunque sea con fallback de UI).
- **GO condicionado** si: talentos falla de forma consistente — se lanza MVP con Player Gap basado solo en gear/stats, se pospone la comparación de talentos.
- **NO-GO / replantear** si: el leaderboard no cubre suficiente profundidad como para generar ningún segmento con n≥30 en el rango 1500-2200 — en ese caso, la estrategia de acumulación por búsqueda pasa de MVP+ a **requisito de día 1**, lo cual alarga el Sprint 0.

# 33. Product Roadmap

| Fase | Objetivo | Funcionalidades | Dependencias | Equipo | Riesgos | Métrica de éxito | GO/NO-GO |
|---|---|---|---|---|---|---|---|
| **Phase 0 — Data Feasibility** | Confirmar que el producto es construible con los datos reales disponibles | Sprint 0 completo (sección 32) | Acceso a Blizzard API | 1 dev full-stack | Riesgo de talentos (sección 30); cobertura de leaderboard insuficiente | Criterios de sección 32 | GO si ≥2 de los 3 pilares de datos (rating, gear, talentos) son fiables |
| **Phase 1 — Internal Data Platform** | Pipeline de ingesta y agregación funcionando de forma continua (no manual) | Jobs programados, schema completo, cálculo de `AggregateSnapshot` automatizado | Phase 0 | 1-2 devs | Rate limiting mal gestionado; calidad de datos (talentos parciales) | Pipeline corre sin intervención manual durante 7 días seguidos | GO si no hay caídas de datos >24h |
| **Phase 2 — MVP** | Producto usable de principio a fin para Solo Shuffle | Player Profile, Player Gap, búsqueda, metodología, build/gear analytics por segmento | Phase 1 | 1-2 devs + diseño ligero | Player Gap poco creíble si la validación cualitativa de Sprint 0 no fue suficiente | Ver sección 25 (6 puntos de demostración) | GO si un grupo cerrado de 20-50 jugadores reales confirma que el Player Gap "tiene sentido" |
| **Phase 3 — Public Beta** | Validar con usuarios reales fuera del círculo cerrado | Lanzamiento en 1-2 comunidades (Reddit/Discord de la spec/clase probada), feedback loop | Phase 2 | Igual + soporte comunitario | Tráfico bajo; feedback negativo sobre precisión | Retención D7, feedback cualitativo positivo mayoritario | GO si retención D7 y sentimiento cualitativo son razonables (umbral a fijar tras ver datos reales — **[UNKNOWN]** no hay baseline de industria fiable para fijar cifra a priori) |
| **Phase 4 — Product-Market Fit** | Expandir bracket (2v2/3v3) y región, empezar a explorar monetización | Sección 27 (V2), primeros experimentos de monetización (sección 37) | Phase 3 con señal positiva | Equipo ampliado si hay tracción | Competencia reacciona copiando Player Gap (riesgo, sección 39) | Crecimiento orgánico sostenido, uso repetido de Player Gap (no solo visita única) | Reevaluar moat (sección 40) antes de invertir más |
| **Phase 5 — Scale** | Multi-región, multi-bracket completo, posible expansión de producto | Sección 27 (V3/Future) | Phase 4 con PMF confirmado | Equipo de producto completo | Sobre-extensión de alcance (volver a las trampas de sección 35 del brief) | Métricas de negocio sostenibles (sección 38) | — |

# 34. Validation Experiments

**[DECISION] 10 experimentos, ordenados por impacto/esfuerzo:**

| # | Experimento | Impacto | Esfuerzo | Orden |
|---|---|---|---|---|
| 1 | Generar manualmente 10-15 reportes de Player Gap (sin UI, PDF/imagen) y compartirlos 1:1 en Discords de PvP pidiendo feedback directo | Alto | Bajo | 1º |
| 2 | Landing page con el concepto ("See what separates you from the players above you") + captura de email/interés, sin producto funcional detrás | Alto | Bajo | 2º |
| 3 | Publicar 2-3 hallazgos de meta reales (sección 17) como posts en Reddit (r/CompetitiveWoW o similar) citando metodología, medir engagement/tráfico referido | Medio-Alto | Bajo | 3º |
| 4 | Prototipo clicable (Figma o HTML estático con datos reales de Sprint 0) para testear el flujo de UX de la sección 23 con 5-10 usuarios | Alto | Medio | 4º |
| 5 | Fake door: botón "Compara tu personaje" en la landing que lleva a un formulario/waitlist en vez de al producto real, medir tasa de clic | Medio | Bajo | 5º |
| 6 | Entrevistas cualitativas (5-8) con jugadores del ICP (1500-2200) sobre cómo deciden qué cambiar en su build hoy | Alto | Medio | 6º |
| 7 | Encuesta corta en Discords de clase/spec sobre frustraciones actuales con herramientas existentes | Medio | Bajo | 7º |
| 8 | MVP funcional cerrado (beta privada) con 20-50 usuarios reclutados de los pasos 1/6/7, medir uso repetido de Player Gap (no solo visita única) | Alto | Alto | 8º |
| 9 | Testear disposición a pagar de forma indirecta (p.ej. "¿pagarías X por ver esto para 3 personajes más?" en la encuesta del beta cerrado) — nunca cobrar de verdad todavía | Medio | Bajo (una vez hay beta) | 9º |
| 10 | SEO landing pages de prueba (2-3 páginas de segmento reales, sección 22) publicadas antes del lanzamiento completo, medir indexación y tráfico orgánico inicial | Medio | Medio | 10º |

# 35. Product Metrics

**North Star Metric [DECISION]:**

> **Player Gap views con resultado de confianza "High" o "Medium" por usuario único activo semanal.**

No es "visitas totales" ni "búsquedas de personaje" — es específicamente el uso de la funcionalidad núcleo, y excluye los casos en que mostramos "muestra insuficiente" (porque ahí no hemos entregado valor real).

**Métricas secundarias:**

| Métrica | Qué mide |
|---|---|
| WAU / MAU | Alcance general |
| Sessions per user | Frecuencia de vuelta (relevante porque el ICP consulta esto entre sesiones de juego) |
| Retention D1/D7/D30 | Si el producto genera hábito, no solo curiosidad puntual |
| Character searches | Volumen de entrada al funnel |
| Player Gap usage rate (searches → Player Gap view) | Conversión interna del funnel principal |
| % de Player Gap views con confianza Low (mostrando "sin datos suficientes") | **Métrica de salud del dato**, no de producto — si sube mucho, la cobertura de población es insuficiente (alimenta decisión de acumulación por búsqueda, sección 12) |
| SEO traffic vs. direct/product traffic | Diversificación de canal (principio 10) |
| Retorno desde comunidades (Reddit/Discord referral) | Salud del canal no-SEO |
| Premium conversion (post-monetización) | Ver sección 37 |
| Churn | Salud de retención a medio plazo |

**Qué demuestra que hemos creado un producto útil**: retención D7 razonable **combinada con** una tasa baja de "confianza insuficiente" en Player Gap — las dos cosas a la vez, no una sin la otra (un producto con buena retención pero datos poco fiables es una ilusión temporal).

---

# 36. Monetization

**[HYPOTHESIS — todo esto es a validar, no compromiso de negocio]**

| Free (siempre) | Premium (hipótesis a validar) |
|---|---|
| Player Gap básico (1 comparación activa) | Player Gap avanzado: múltiples personajes guardados, comparación histórica ("¿cómo ha cambiado mi gap en las últimas 4 semanas?") |
| Búsqueda de personaje | Alertas (cambio de segmento propio, cambios de meta relevantes para tu spec) |
| Perfil y rating actual | Histórico completo extendido (más allá de la temporada actual) |
| Meta/build/gear analytics por segmento | Comparaciones jugador vs. jugador ilimitadas (si en free se limita el volumen) |
| Página de metodología | Exportación de datos/reportes |

**[DECISION] Qué NUNCA debería estar tras paywall**: el Player Gap básico en sí mismo — es el producto core y la propuesta de valor; ponerlo tras paywall mataría la adquisición y contradice el principio de "demostrar valor antes de pedir nada" (coherente con cómo operan hoy Seramate/Drustvar/Check-PvP, todos gratuitos en su capa core, con Seramate monetizando extras vía Patreon según su propia página de comparación pública — **[FACT]**).

**[UNKNOWN]** Precio potencial y willingness to pay reales — no hay dato propio; **[ASSUMPTION]** de partida, tomando como referencia pública que Seramate ofrece "tiers de Patreon" para IA/ad-free/personalización (no se han encontrado cifras concretas de precio en esta investigación), un rango de suscripción mensual baja (single-dígito de dólares/euros) es razonable como hipótesis inicial de mercado, a validar con el experimento 9 (sección 34) antes de fijar cualquier precio real.

**Publicidad**: posible en el tier free (referencia: Seramate ofrece "Zero Ads" como beneficio premium, lo cual implica que su tier free sí tiene anuncios — **[FACT]** inferido de su propia tabla comparativa). **[DECISION]** No es prioridad de fase MVP/Beta — introducir solo si el volumen de tráfico lo justifica económicamente, para no dañar la experiencia mobile-first (principio 11) desde el día 1.

# 37. Business Model

**[DECISION] No se construye un P&L detallado — faltan datos de tráfico, conversión y coste de infraestructura real (sección 6, UNKNOWN de mercado).**

**Modelo de negocio conceptual:**
- **Revenue streams potenciales**: suscripción premium (freemium), posible publicidad en tier gratuito a partir de tracción, posibles colaboraciones con creadores de contenido (sin comprometer la neutralidad editorial del principio "correlación, no causalidad").
- **Costes principales**: infraestructura (bajo en MVP dado el stack sin sobrearquitectura de sección 29), tiempo de desarrollo (principal coste real en fase temprana, equipo pequeño), eventualmente soporte/comunidad.
- **Unit economics conceptuales**: el coste marginal por usuario adicional es bajo (cacheo + límites de rate limit de Blizzard son el principal constraint técnico, no el coste de servir tráfico); el driver de coste real es el volumen de llamadas a la API de Blizzard y el almacenamiento de histórico de snapshots, que crece de forma lineal con el tiempo y la cobertura de población — motivo adicional para no perseguir "toda la población de WoW" desde el día 1 sin necesidad.

**Datos necesarios antes de construir el modelo financiero real [UNKNOWN, todos]:**
- Tráfico real alcanzable (comparado con competidores establecidos).
- Tasa de conversión free→premium observada en beta.
- Coste real de infraestructura a escala de Phase 3/4.
- Elasticidad de precio del ICP.

# 38. Risk Register

| Riesgo | Probabilidad | Impacto | Severity | Mitigación | Experimento de validación |
|---|---|---|---|---|---|
| Endpoint de talentos inestable/roto (histórico confirmado post-parche 11.2) | Media-Alta | Alto (afecta directamente al Player Gap) | **Alto** | Fallback de UI sin talentos; monitorización activa del endpoint; no depender de talentos como única fuente de diferenciación (gear/stats como respaldo) | Sprint 0, tarea día 2-3 |
| Cobertura insuficiente de leaderboard en rango medio (1500-2200) | Media | Alto (sin población, no hay Player Gap creíble) | **Alto** | Acumulación por búsqueda de usuario desde el día 1 si Sprint 0 lo confirma necesario | Sprint 0, tarea día 12-14 |
| Rate limits de Blizzard (100/s, 36.000/h) limitan la velocidad de construcción de población | Media | Medio | Medio | Priorización de colas (sección 28); solicitar aumento de límite si hay tracción real | Monitorización continua en Phase 1 |
| Scraping/ToS: dependencia de datos fuera de la API oficial | Baja (si nos ceñimos estrictamente a la API oficial, como está diseñado este plan) | Alto si ocurriera | Bajo (con el diseño actual) | No hacer scraping de terceros; usar solo la API oficial documentada | N/A — decisión de diseño, no experimento |
| Data freshness: usuarios esperan tiempo real, Blizzard publica cada ~3h | Media | Bajo-Medio | Medio | Comunicar claramente "última actualización" en UI (igual que hacen los competidores); no prometer "tiempo real" | N/A — gestión de expectativas de producto |
| Tráfico bajo / no hay suficiente interés | Media | Alto | Alto | Experimentos 1-3 y 10 de sección 34 antes de invertir en MVP completo | Sección 34 |
| Dependencia de SEO | Media | Medio | Medio | Diversificación de canal desde Sprint 0/Beta (Reddit/Discord/creadores) | Experimento 3, sección 34 |
| Competidores copian Player Gap | Media-Alta (es una idea razonablemente obvia una vez publicada) | Medio | Medio | El moat no es la feature en sí, es el dataset acumulado + la ejecución de calidad de datos (sección 40) | N/A |
| Murlok/Drustvar/Seramate añaden features similares directamente | Media | Medio-Alto | Medio-Alto | Foco en profundidad (Player Gap bien hecho) frente a su amplitud; Drustvar ya tiene un "Character Audit" en beta — vigilar de cerca su evolución | Seguimiento competitivo continuo |
| Usuarios no pagan (monetización) | Alta (es la norma en este nicho — ver Seramate/Drustvar gratuitos con extras opcionales) | Medio | Medio | No depender de revenue temprano para la validación de producto (secciones 34/35 no requieren monetización) | Experimento 9, sección 34 |
| Recomendaciones incorrectas / interpretadas como causales por el usuario a pesar del copy | Media | Alto (daño reputacional/de confianza) | **Alto** | Diseño de UI que fuerza mostrar n y confianza siempre visibles, nunca en tooltip oculto (sección 13.5) | Validación cualitativa en Sprint 0 y Phase 2 |
| Estadísticas engañosas por tamaño de muestra insuficiente | Media | Alto | Alto | Umbrales estrictos de sección 13.4, aplicados también a SEO (sección 22) | Integrado en el diseño, no opcional |

# 39. Competitive Moats

**Pregunta central: "Si mañana Murlok copia nuestra interfaz, ¿qué nos queda?"**

La respuesta no puede ser "una interfaz mejor" — la interfaz se copia en semanas. Lo que sí es defendible con el tiempo:

| Moat candidato | ¿Defendible? | Por qué |
|---|---|---|
| **Dataset histórico acumulado** (snapshots propios desde el día 1, incluida la acumulación por búsqueda de usuario) | **Sí, con el tiempo** | Cuantos más meses de snapshots propios acumulemos, más profundo es nuestro histórico y más fiable nuestra cobertura de rango medio — algo que un competidor no puede replicar retroactivamente el día que decide copiar la feature |
| **Metodología de confianza estadística** (umbrales, comunicación de incertidumbre) | Parcialmente | Es replicable técnicamente, pero requiere disciplina de producto sostenida — más una cuestión de cultura de producto que de código |
| **Algoritmos de detección de poder discriminante / anti-FOTM** | Parcialmente | Mejora con el volumen de datos históricos (moat compuesto con el anterior) |
| **UX/interfaz** | **No** | Se copia rápido, no es un moat por sí solo |
| **SEO acumulado** (páginas de segmento indexadas y con autoridad) | Sí, con el tiempo | Autoridad de dominio y contenido único tarda en construirse y en ser superado |
| **Marca/comunidad** | Parcialmente, a largo plazo | Requiere tiempo y ejecución consistente del posicionamiento (sección 7) |
| **Network effects** | Débil en este producto | A diferencia de un LFG o una red social, Player Gap no tiene efecto de red directo — el valor no crece mecánicamente con más usuarios, aunque sí crece la cobertura de población (efecto de red *indirecto y lento*) |
| **Switching costs** | Bajo | Un jugador puede consultar varias herramientas sin coste — no hay lock-in natural salvo cuentas/favoritos guardados |

**[DECISION]** El moat real y defendible a 12-24 meses es la combinación de **(dataset histórico propio) + (disciplina metodológica visible)** — ninguna de las dos se copia de un día para otro, a diferencia de la interfaz o incluso la idea del feature.

# 40. Open Questions

**[UNKNOWN — pendientes de validación antes o durante Sprint 0/Beta, listadas explícitamente para no perderlas:**
1. ¿Está resuelto de forma estable el problema de `talent_loadout_code` a fecha de inicio real del proyecto? (sección 30 — validar primero, es bloqueante parcial).
2. ¿Existe algún endpoint agregado de composición de equipo para 2v2/3v3/RBG que no se haya identificado en esta investigación? (sección 18).
3. ¿Cuál es la cobertura real del rango 1500-2200 usando solo el leaderboard, sin acumulación por búsqueda? (Sprint 0, tarea 12-14).
4. ¿US o EU como región de lanzamiento? Requiere alguna señal de volumen relativo — no cubierto de forma fiable por esta investigación.
5. Tráfico y conversión reales de los competidores directos — no accesible sin herramientas de terceros no verificadas en esta pasada de investigación.
6. Willingness to pay real del ICP — pendiente del experimento 9 (sección 34).
7. Umbral de retención D7 "razonable" para este nicho — sin baseline de industria fiable identificado.

# 41. Final Recommendation

**[DECISION]** Construir el MVP descrito en la sección 25, empezando por Sprint 0 (sección 32), con foco exclusivo en:
- Una modalidad (Solo Shuffle).
- Una región.
- Player Gap como única razón de ser del producto en su primera versión — todo lo demás (build/gear analytics, búsqueda, metodología) existe para sostener esa única feature, no como productos independientes.
- Validación de talentos como primer riesgo técnico a resolver, con plan de contingencia ya diseñado (gear/stats sin talentos si hace falta).
- Cero inversión en IA conversacional, LFG, o amplitud de producto hasta que el core esté validado con usuarios reales (sección 34).

No construir nada de las secciones marcadas V2/V3/Future/Never (sección 27) hasta que el North Star Metric (sección 35) muestre señal real de retención y confianza de datos alta.

---

# THE FIRST 30 DAYS

## Semana 1 — Data feasibility

**Objetivos**: confirmar que el producto es técnicamente construible con los datos reales disponibles (equivale a Sprint 0, primera mitad).

**Tareas**: registrar client ID; validar los 4 endpoints core (perfil, rating, gear, talentos); ejecutar específicamente la validación del riesgo de talentos; descargar leaderboard completo de 3-5 specs de Solo Shuffle.

**Entregables**: script de ingesta funcional; reporte de viabilidad de talentos; dataset crudo de leaderboard almacenado.

**Decisiones a tomar al final de la semana**: si talentos es fiable → seguir según plan; si no → activar plan de contingencia (Player Gap sin talentos en el lanzamiento, revisado en Semana 3).

**Métricas**: nº de personajes correctamente ingeridos / nº de personajes intentados (objetivo: >95% de éxito en los 3 endpoints core que no son talentos).

**Criterio de éxito**: los 4 endpoints core devuelven datos coherentes para al menos 50 personajes de prueba distintos, cubriendo varias clases.

## Semana 2 — Dataset + analytics

**Objetivos**: pasar de datos crudos a la primera distribución de población segmentada y al primer cálculo de Player Gap real.

**Tareas**: diseñar y desplegar el schema mínimo de Postgres (sección 27); calcular la primera distribución de rating por buckets de 200; implementar el cálculo de `adoption_rate` y `alignment_score` (sección 13.2); generar 3 reportes de Player Gap reales (aunque sea en script/JSON, sin UI).

**Entregables**: base de datos poblada y consultable; 3 reportes de Player Gap de ejemplo.

**Decisiones a tomar**: si la cobertura del rango 1500-2200 es insuficiente solo con leaderboard, decidir si la acumulación por búsqueda de usuario pasa a ser requisito del MVP (no de MVP+).

**Métricas**: tamaño de muestra por segmento (objetivo: al menos 2-3 buckets centrales con n≥30, idealmente n≥100).

**Criterio de éxito**: al menos un reporte de Player Gap generado con nivel de confianza "Medium" o "High" que un jugador experto de esa spec valide cualitativamente como razonable.

## Semana 3 — MVP UX + Player Profile

**Objetivos**: construir la interfaz mínima usable: búsqueda, perfil, y la primera versión visual de Player Gap.

**Tareas**: implementar homepage + búsqueda de personaje (sección 23); implementar página de perfil con rating/percentil/spec/bracket/actividad; implementar la primera versión visual de Player Gap (barras de alineación + biggest differences, siguiendo el formato de plantilla fija de sección 13.6); implementar página de metodología (obligatoria, sección 24).

**Entregables**: producto navegable de principio a fin para al menos 1 spec completa.

**Decisiones a tomar**: confirmar si talentos entra en el Player Gap visual o se pospone (según lo decidido en Semana 1).

**Métricas**: tiempo de carga del perfil (objetivo: rápido, coherente con principio 9 — sub-2 segundos en condiciones normales).

**Criterio de éxito**: un usuario externo (no del equipo) puede buscar su propio personaje y entender el Player Gap sin explicación previa.

## Semana 4 — Player Gap + primera beta

**Objetivos**: ampliar cobertura a varias specs, cerrar el círculo con usuarios reales, y ejecutar los primeros experimentos de validación de bajo coste.

**Tareas**: ampliar la ingesta a más specs de Solo Shuffle (no solo las 3-5 iniciales); reclutar 20-50 usuarios reales de Discords/comunidades de PvP (experimentos 1 y 6 de sección 34) para una beta cerrada; instrumentar analítica de producto (PostHog, sección 29) centrada en el North Star Metric (sección 35).

**Entregables**: beta cerrada funcionando con usuarios reales; primeras métricas de uso de Player Gap.

**Decisiones a tomar**: criterio de GO/NO-GO hacia Phase 3 (Public Beta, sección 33) según el feedback cualitativo y las primeras métricas de uso repetido.

**Métricas**: North Star Metric (Player Gap views con confianza Medium/High por usuario único semanal); % de búsquedas que resultan en confianza "Low/Insufficient" (métrica de salud del dato).

**Criterio de éxito**: al menos un subconjunto de los 20-50 usuarios de beta vuelve a usar el producto sin que se les pida explícitamente (señal de valor real, no solo cortesía hacia el equipo).

---

# "If I were the founder, this is exactly what I would build first."

Construiría **solo** esto en los primeros 30 días, sin excepción:

1. Ingesta de datos de Solo Shuffle vía la API oficial de Blizzard, para 5-10 specs iniciales, con validación explícita y prioritaria del endpoint de talentos (es el único riesgo de datos que puede tumbar la feature central).
2. Un modelo de datos append-only con snapshots (nunca sobreescribir), porque el histórico gratuito que esto genera es, con el tiempo, el moat más defendible que tenemos (sección 39) — mucho más que cualquier feature visible.
3. Player Gap, y solo Player Gap, como interfaz. Nada de meta analytics elaborado, nada de comparación jugador vs. jugador, nada de trends con gráficos bonitos — todo eso es ruido hasta que la feature central esté validada con gente real.
4. Umbrales de confianza estadística estrictos desde el primer día, no como algo que "se añade después" — es lo que separa este producto de "otro sitio con números" y es imposible de añadir de forma creíble a posteriori sin generar desconfianza retroactiva.
5. Una página de metodología pública desde el lanzamiento, aunque sea sencilla — es lo que hace que "correlación, no causalidad" sea una promesa creíble y no solo una frase en este documento.

Dejaría fuera, sin excepción, hasta tener señal real de retención: IA conversacional, LFG, cobertura multi-bracket, multi-región, comparación jugador vs. jugador, y cualquier cosa que empiece a competir en amplitud con Seramate o Drustvar. Esa batalla ya la están librando ellos entre sí desde hace tiempo — la nuestra es otra, y es más pequeña, más difícil de copiar rápido, y hoy nadie la está librando: **decirle a un jugador de 1840, con datos y con honestidad sobre la incertidumbre, qué es lo que de verdad le separa de 2000.**
