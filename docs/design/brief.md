# Design brief

Dónde se deciden las cosas que se ven. Los ADR de `docs/decisions` son de arquitectura; meter ahí "el tema es oscuro" los diluye, así que las decisiones de pantalla, jerarquía y estados viven aquí ([#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65)).

Hoy este documento contiene tres secciones: **el contenido de la caja Player Gap**, que era lo que bloqueaba al resto ([#57](https://github.com/Atorey/wow-pvp-intelligence/issues/57)); **la página fuera de cobertura** ([#58](https://github.com/Atorey/wow-pvp-intelligence/issues/58)), que es lo que se ve cuando esa caja no tiene con qué llenarse — hoy, siempre; y **el idioma, la marca y el tono de voz** ([#59](https://github.com/Atorey/wow-pvp-intelligence/issues/59)), que condicionan todo lo que se escriba a partir de ahora. El sistema visual —tokens, tipografía, tema, componentes— es #65 y aún no está escrito.

> **El idioma ya está decidido (#59): el producto es bilingüe inglés/español, con el inglés como idioma fuente.** El inglés de los wireframes de §1 y §2 deja de ser provisional en cuanto a la lengua — lo que sigue siendo provisional es la redacción concreta, no el idioma. La parte estructural de esa decisión (prefijo de locale, slugs, `hreflang`, dónde vive el copy) está en el [ADR 0012](../decisions/0012-producto-bilingue.md); lo que se ve y lo que se dice, en la [§3](#3-idioma-marca-y-tono-de-voz).

---

## 1. La caja Player Gap

### 1.1 Qué se decide aquí

El mockup de §13.1 del plan promete cuatro barras —Talents, Gear, Stats, Embellishments— y hoy **ninguna de las cuatro se puede pintar como barra**. Maquetar ese ASCII y descubrirlo al conectar los datos es perder el trabajo entero, así que esta sección decide qué enseña la caja **"WHAT SEPARATES YOU FROM 2000+?"** con lo que de verdad existe, y en sus tres estados de confianza.

Consume [`computePlayerGap()`](../../packages/core/src/player-gap.ts) y nada más. Si algo no sale de ahí, no está en la caja.

### 1.2 Inventario: qué puede decir la caja hoy

| Categoría del mockup  | Estado                     | Por qué                                                                                                                                                                                              |
| --------------------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gear**              | ✅ calculable              | `gearAlignment()` y `biggestGearDifferences()`, con señal discriminante demostrada ([§6.1 de findings](../sprint-0-findings.md))                                                                     |
| **Talents**           | ⚠️ dato sí, comparación no | `compareTalents()` devuelve `hasUsableSignal: false`: 85 códigos distintos entre 98 perfiles. El MVP se lanza sin esta categoría, decidido el 21 de agosto de 2026 ([§8.2](../sprint-0-findings.md)) |
| **Stats** secundarias | ❌ no hay dato             | `character_snapshot_gear` no las guarda; `AggregateVariableKind` es un conjunto cerrado a propósito                                                                                                  |
| **Embellishments**    | ❌ no hay dato             | Igual que el anterior                                                                                                                                                                                |

Y hay algo **calculable que no está en el mockup**: `compareItemLevel()` da el item level equipado del jugador y las medianas de los dos segmentos. Es dato real, es comparable y responde literalmente a la pregunta del título.

### 1.3 Decisión — la caja es una lista, no un panel de barras

**Se abandonan las barras.** La caja la ocupa la **lista de mayores diferencias de gear** en el formato fijo de §13.6, precedida por una cabecera con las dos cifras de contexto —item level y solapamiento de gear— y cerrada por la nota de causalidad.

Anatomía, de arriba abajo:

1. **Título y sujeto** — la pregunta, la spec/bracket/rating y el par de segmentos.
2. **La muestra, siempre visible** — `n` del segmento objetivo y nivel de confianza, dentro de la caja y nunca en un tooltip (§13.5).
3. **Dos cifras de contexto** — item level equipado (tú / mediana del objetivo) y solapamiento de gear, cada una con su lectura literal al lado.
4. **La lista** — hasta 5 diferencias, ordenadas por |delta|, solo las que pasan `isDiscriminative()`. **Si hay menos, la lista sale más corta**: no se rellena para cuadrar el número.
5. **Lo que falta, declarado** — talentos, stats y embellishments no se omiten en silencio.
6. **La nota de causalidad**, fija.

**El formato de §13.6 se cumple como contrato de datos, no como frase literal repetida.** La plantilla exige cuatro datos junto al porcentaje: variable, % del objetivo, % del segmento propio y muestra. En la caja, `bracket`, `spec` y `n` viven en la cabecera —declarados una vez y siempre visibles dentro del mismo bloque— y cada fila lleva las dos adopciones con su fracción cruda (`41% (128/312)`). Repetir "in the 2000-2200 segment (Solo Shuffle, Frost Mage, n=312)" cinco veces no añade honestidad, añade ruido.

### 1.4 Por qué no barras

**Porque la única barra posible mide otra cosa de la que parece.** El `gearAlignment()` es la media de la adopción que tienen _tus_ items en el segmento de arriba. Pintado como barra bajo el título "qué te separa de 2000+", se lee como un marcador de progreso hacia ese rating. No lo es.

**Y hay dato de que se leería mal.** Los tres Player Gap reales de Sprint 0, mismo bracket y mismo par de segmentos:

| Personaje | Item level equipado | Mediana del objetivo | Gear alignment |
| --------- | ------------------: | -------------------: | -------------: |
| Collînna  |                 285 |                  246 |        **27%** |
| Teyshwarr |                 246 |                  249 |            33% |
| Loode     |                 263 |                  245 |            37% |

El mejor equipado de los tres saca la barra más baja. No es un bug: cuanto más raro es un item, menos gente del segmento lo lleva, y la media baja. Con n=3 esto no es una ley, pero basta para no construir el titular encima. El 88% del mockup, además, no aparece en ningún caso medido: el rango real fue 27-37%, y una barra al 27% comunica "suspenso" donde el dato dice "llevas cosas poco frecuentes".

**Porque cuatro huecos con una categoría son tres huecos vacíos.** Un panel de barras con una sola barra no es un panel: es una barra con tres ausencias enmarcadas. Y rellenarlas partiendo el gear en sub-categorías inventadas (Armas / Abalorios / Anillos / Armadura) sería dejar que la forma de la maqueta dicte la taxonomía del análisis.

**Porque la lista sí está completa.** `biggestGearDifferences()` devuelve las dos adopciones con sus denominadores: es exactamente lo que §13.6 pide y no necesita nada que no tengamos.

**Sobre §23** ("barras de progreso/porcentaje en vez de tablas densas" en móvil): la restricción real de esa línea es no meter tablas densas en el móvil, y se respeta. La lista no es una tabla, son filas apiladas con dos porcentajes cada una, y cabe en una columna estrecha sin scroll horizontal. Los wireframes de abajo están dibujados a ancho de móvil por eso.

### 1.5 Los tres estados de confianza

Son **tres layouts distintos**, no el mismo layout en tres colores. `canShowComparison()` decide y la UI obedece ([ADR 0003](../decisions/0003-umbrales-de-confianza.md)).

**El n que manda es el `gear_sample` del segmento objetivo, no su `sample_size`** (decisión 3 del [ADR 0010](../decisions/0010-cobertura-por-segmento.md)). Población no es base de comparación: en la corrida del 22 de agosto de 2026 hay 257 segmentos con n≥30 de población y `gear_sample = 0` en los 439 ([§13 de findings](../sprint-0-findings.md); la cifra de 357 que se citó aquí antes era el acumulado de la tabla, no una corrida).

#### Estado `high` — n ≥ 100

```
┌──────────────────────────────────┐
│ WHAT SEPARATES YOU FROM 2000+?   │
│ Frost Mage · Solo Shuffle · 1994 │
│ You 1800–2000 → target 2000–2200 │
│ 312 players sampled in 2000–2200 │
│ Confidence: high                 │
├──────────────────────────────────┤
│ Item level (equipped)            │
│ You 263 · 2000–2200 median 246   │
│                                  │
│ Gear overlap                     │
│ Your items are worn by an avg of │
│ 37% of 2000–2200 (15 items)      │
├──────────────────────────────────┤
│ WHAT 2000–2200 WEARS MORE        │
│                                  │
│ 1. Galactic Gladiator's Silk     │
│    Cord · Waist                  │
│    41% (128/312) up there        │
│    21% (64/305) in your segment  │
│    ✓ you wear this               │
│                                  │
│ 2. Galactic Gladiator's Necklace │
│    54% (168/312) · 39% (119/305) │
│                                  │
│ 3. …up to 5, fewer if fewer pass │
├──────────────────────────────────┤
│ Not compared yet: talents,       │
│ secondary stats, embellishments. │
│                                  │
│ This does not mean changing      │
│ these will raise your rating.    │
└──────────────────────────────────┘
```

#### Estado `medium` — 30 ≤ n < 100

Mismo contenido **más un bloque de aviso que ocupa espacio y desplaza al resto**. No es un borde de color ni un icono: si el aviso se puede pasar por alto haciendo scroll rápido, no cumple "aviso visible" (§13.4).

```
┌──────────────────────────────────┐
│ WHAT SEPARATES YOU FROM 2000+?   │
│ Frost Mage · Solo Shuffle · 1994 │
│ You 1800–2000 → target 2000–2200 │
│ 98 players sampled in 2000–2200  │
│ Confidence: medium               │
├──────────────────────────────────┤
│ ⚠ Small sample (30–99 players).  │
│   These percentages will move as │
│   we sample more of this segment.│
├──────────────────────────────────┤
│ Item level (equipped)            │
│ You 263 · 2000–2200 median 246   │
│ …resto idéntico al estado high   │
└──────────────────────────────────┘
```

#### Estado `insufficient` — n < 30

**El contenido se sustituye por la explicación.** No hay lista recortada, ni barras a cero, ni números en gris "de muestra", ni un "coming soon" con datos de relleno. La caja **mantiene su sitio y su tamaño** encima del pliegue (§23): desaparecer no explica nada.

Y el mensaje distingue dos causas que hoy se confunden, porque una es del juego y la otra es nuestra.

**(a) No hay bastante gente ahí arriba todavía.**

```
┌──────────────────────────────────┐
│ WHAT SEPARATES YOU FROM 2000+?   │
│ Frost Mage · Solo Shuffle · 1994 │
│ You 1800–2000 → target 2000–2200 │
├──────────────────────────────────┤
│ No comparison yet.               │
│                                  │
│ Only 12 Frost Mages have reached │
│ 2000–2200 this season. We need   │
│ 30 before any percentage means   │
│ anything.                        │
│                                  │
│ Season 42 started 3 days ago —   │
│ this segment fills up as people  │
│ climb.                           │
├──────────────────────────────────┤
│ …resto de la página en §2        │
└──────────────────────────────────┘
```

**(b) Hay gente; lo que no tenemos es su equipo.** Es el caso mayoritario hoy y hay que contarlo sin disfrazarlo: decir "no hay suficientes jugadores en 2000-2200" cuando hay 287 sería echarle al juego la culpa de nuestro muestreo.

```
┌──────────────────────────────────┐
│ WHAT SEPARATES YOU FROM 2000+?   │
│ Frost Mage · Solo Shuffle · 1994 │
│ You 1800–2000 → target 2000–2200 │
├──────────────────────────────────┤
│ No comparison yet.               │
│                                  │
│ 287 players are in 2000–2200,    │
│ but we've only loaded the gear   │
│ of 4 of them. We need 30 to      │
│ compare. That's on us, and it's  │
│ filling in.                      │
├──────────────────────────────────┤
│ …resto de la página en §2        │
└──────────────────────────────────┘
```

Los dos wireframes acaban en el mismo hueco, y ese hueco ya está resuelto: **qué más se le ofrece a ese jugador en el resto de la página es la [§2](#2-la-página-fuera-de-cobertura)** ([#58](https://github.com/Atorey/wow-pvp-intelligence/issues/58), [ADR 0011](../decisions/0011-fuera-de-cobertura-se-describe-no-se-compara.md)). Aquí se fija qué ocupa la caja; allí, qué la rodea.

### 1.6 Estado adyacente — no hay escalón de arriba

`nextSegment()` devuelve `undefined` en el tramo abierto superior: un jugador de 3000+ no tiene segmento objetivo, y eso no es falta de muestra. La caja se sustituye por la constatación —"you're in the top segment; there's no next one to compare against"— y **no** se rellena comparándolo contra su propio segmento. §13.1 contempla esa comparación como opcional, pero es otra promesa de producto ("en qué te pareces a tus pares", no "qué te separa del siguiente escalón") y necesita su propia decisión. No entra en el MVP por defecto.

### 1.7 Reglas que la caja hereda y no puede relajar

- **Ningún verbo de recomendación** en el copy de la caja, ni en las etiquetas ni en el título de la lista. Por eso la lista se llama _"what 2000–2200 wears more"_ y no _"what to change"_ (regla 3, §13.5).
- **La muestra va pegada al porcentaje**, nunca en un tooltip. Cada fila lleva su fracción cruda, no solo el %.
- **Las diferencias por debajo de `MIN_DISCRIMINATIVE_DELTA` no se muestran** "por completitud" (§13.5). La lista corta es un resultado, no un fallo de maquetación.
- **`null` es "no disponible"**, y se dice. Los perfiles sin gear legible salen del denominador y esa exclusión se declara, no se esconde (regla 5).
- **La confianza no se comunica solo por color**: en `medium` es un bloque de texto, en `insufficient` es el contenido entero. Sin distinguir colores se recibe exactamente la misma información (#65).

### 1.8 Qué NO entra en la caja

- Barras de progreso de cualquier tipo, incluida una sola.
- Las categorías Talents, Stats y Embellishments como huecos con valor. Se nombran como ausencias en una línea, y ya.
- El top-3 de códigos de talentos de `compareTalents()` mientras `hasUsableSignal` sea `false`: un "el 7% de 2000-2200 usa esta build" describe a siete personas, no a un segmento.
- Comparaciones contra el top 100 global, o contra la cima como objetivo por defecto (§13.5).
- Perfiles de la temporada anterior para rellenar el hueco del arranque (decisión 6 del [ADR 0010](../decisions/0010-cobertura-por-segmento.md)).

### 1.9 Consecuencias

- **[#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18) queda desbloqueada** con el contenido cerrado: una lista y dos cifras de contexto, en tres layouts. La página que rodea a la caja está en la [§2](#2-la-página-fuera-de-cobertura).
- **#18 necesita distinguir las dos causas de §1.5.** Hoy el `reason` de `PlayerGapUnavailable` dice "no hay suficientes jugadores muestreados en X" para los dos casos, y son distintos: uno es población que no existe, el otro es muestreo que nos falta. La distinción es de copy y de dato (`sample_size` frente a `gear_sample`), y sale de `population_segments` sin trabajo nuevo.
- **[#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65) hereda componentes concretos que tokenizar**, no un mockup por decidir: fila de diferencia, bloque de aviso y bloque de sustitución.
- **[#24](https://github.com/Atorey/wow-pvp-intelligence/issues/24) tiene sitio reservado y ninguna forma que romper.** Cuando los talentos se decodifiquen en nodos, cada nodo es una variable más de la misma lista, con la misma fila. No hay que rediseñar la caja para meterlos: era la otra ventaja de no tener barras por categoría.
- **Queda por vigilar la lectura del gear alignment.** La inversión de §1.4 está medida sobre tres personajes; cuando [#66](https://github.com/Atorey/wow-pvp-intelligence/issues/66) traiga muestra de verdad hay que volver a mirarla, porque si se confirma, la cifra de contexto tampoco se sostiene y la caja se queda con item level y la lista.

---

## 2. La página fuera de cobertura

### 2.1 Qué se decide aquí

Los dos wireframes de §1.5 acaban en el mismo hueco —el que decía "resto de la página en §2"—. Esta sección lo rellena: decide **qué rodea a la caja Player Gap cuando la caja está en `insufficient`**, que hoy es siempre.

La regla de fondo la fija el [ADR 0011](../decisions/0011-fuera-de-cobertura-se-describe-no-se-compara.md): fuera de cobertura la página **describe** la población, no sustituye la comparación por otra. Aquí se decide la forma: qué bloques, en qué orden y qué dice cada hueco.

### 2.2 El caso, con números

No es un estado de borde. Medido el 22 de agosto de 2026 ([§13 de findings](../sprint-0-findings.md)):

| Dato                                             |               Valor |
| ------------------------------------------------ | ------------------: |
| Pares `(personaje, bracket)` observados en la 42 |              23.768 |
| …con el segmento objetivo poblado a n≥30         | 20.293 (**85,4 %**) |
| …con Player Gap servible (`gear_sample` ≥ 30)    |         **0** (0 %) |
| Filas de la corrida diaria con `gear_sample > 0` |         **0** / 439 |

Traducido a diseño: **la caja está vacía el 100 % de las veces, y en el 85,4 % de ellas por la causa (b) de §1.5** —hay gente en el segmento objetivo, lo que falta es su equipo—. Cualquier maqueta que trate este estado como excepción está maquetando el 0 % de las visitas.

Y hay más que decir de lo que parece: el rating, la actividad y la posición dentro de la spec **no necesitan ni un perfil ajeno**. Salen de la consulta on-demand del propio jugador y de la población del leaderboard.

### 2.3 Los bloques, en orden

1. **Identidad y estado propio** — personaje, clase/spec, bracket, rating actual, partidas de la temporada e item level equipado. Es lo único que no depende de nadie más: sale del perfil del propio jugador.
2. **La caja Player Gap**, en su estado `insufficient` con la causa correcta (§1.5). **Mantiene su sitio y su tamaño encima del pliegue**; no se mueve abajo porque esté vacía.
3. **Dónde estás dentro de tu spec** — el bloque descriptivo. Posición en la población observada del bracket, tamaño del propio segmento y del objetivo.
4. **Qué falta y por qué** — una línea por ausencia, con su causa. Sin fechas.
5. **Metodología** — enlace fijo, no un tooltip.

El orden no es negociable en un punto: **el bloque 3 va después del 2, nunca antes**. Si la primera cifra grande de la página es un percentil, la página promete percentiles y la caja vacía se lee como un fallo. Al revés, la caja declara lo que no hay y el bloque 3 se lee como lo que es: lo que sí se puede decir mientras tanto.

### 2.4 Wireframe — un Holy Priest a 1650, el día del lanzamiento

Los números son los medidos el 22 de agosto de 2026 en `shuffle-priest-holy`, no inventados. El copy está en inglés porque el inglés es el idioma fuente ([§3.2](#32-el-idioma-del-copy), [ADR 0012](../decisions/0012-producto-bilingue.md)); la versión en español dice lo mismo y ocupa más, que es la restricción que hereda #65.

```
┌──────────────────────────────────┐
│ Ashenveil · Kelvara              │
│ Holy Priest · Solo Shuffle       │
│                                  │
│ Rating 1650                      │
│ 42 played · 22 won · 20 lost     │
│ Item level (equipped) 251        │
├──────────────────────────────────┤
│ WHAT SEPARATES YOU FROM 1800+?   │
│ Holy Priest · Solo Shuffle ·1650 │
│ You 1600–1800 → target 1800–2000 │
│                                  │
│ No comparison yet.               │
│                                  │
│ 285 players are in 1800–2000,    │
│ but we've loaded the gear of 0   │
│ of them. We need 30 to compare.  │
│ That's on us, and it's filling   │
│ in.                              │
├──────────────────────────────────┤
│ WHERE YOU STAND                  │
│                                  │
│ 1,598 of the 2,282 Holy Priests  │
│ we've observed this season are   │
│ below 1650.                      │
│ That's the 70th percentile.      │
│                                  │
│ Your segment 1600–1800: 474      │
│ Next segment 1800–2000: 285      │
│ Highest observed: 2709           │
│                                  │
│ Observed = seen on the ladder or │
│ looked up here. Not every player.│
├──────────────────────────────────┤
│ WHAT'S MISSING                   │
│                                  │
│ Gear of 1800–2000 — 0 of 285     │
│ profiles loaded. Needed for the  │
│ comparison above.                │
│                                  │
│ Item level of 1800–2000 — same   │
│ reason: no profiles yet.         │
│                                  │
│ Talents — not compared in this   │
│ release.                         │
├──────────────────────────────────┤
│ How we count this → Methodology  │
└──────────────────────────────────┘
```

**Variante (a): no hay gente arriba, no es cosa nuestra.** Cambia el bloque 2 al wireframe (a) de §1.5 y la primera línea del bloque 4 pasa a `Players in 1800–2000 — 12 so far. We need 30.` El bloque 3 no cambia: la posición del sujeto se sabe igual.

**Variante: el bracket entero no llega a `MIN_SAMPLE_MEDIUM`.** Desaparece la línea del percentil, se queda la fracción:

```
│ 3 of the 6 Feral Druids we've    │
│ observed this season are below   │
│ 1650.                            │
```

"Percentil 50" sobre 6 personas es una cifra con forma de estadística; "3 de 6" es el mismo dato sin el disfraz.

**Variante: no hay escalón de arriba** (§1.6). El bloque 2 dice que no hay segmento siguiente, el bloque 3 se mantiene entero —es donde el jugador del tramo abierto tiene todo su contenido— y el bloque 4 desaparece: no falta nada, no hay nada que comparar.

### 2.5 Reglas de copy del bloque descriptivo

- **"Observed", nunca "players"**, y con la definición a la vista una vez por página. La población observada depende del tope del leaderboard y del punto de la temporada; presentarla como el censo es la mentira fácil de esta pantalla (decisión 6 del [ADR 0011](../decisions/0011-fuera-de-cobertura-se-describe-no-se-compara.md)).
- **La fracción manda, el porcentaje acompaña.** Primero "1.598 de 2.282", después "percentil 70". Nunca el percentil solo.
- **Ningún verbo de recomendación**, igual que en la caja (§1.7). "Where you stand" describe; "what to do next" recomendaría.
- **Nada de fechas ni de ETA.** "It's filling in" es una promesa de intención; "next week" es una promesa de calendario que no controlamos — la cobertura depende de la temporada y del presupuesto de cuota (#66).
- **Las ausencias se cuentan con su denominador**: "0 of 285 profiles loaded", no "no data". Un cero con denominador dice de quién es el problema.

### 2.6 Qué NO entra en la página fuera de cobertura

- **Comparación contra un segmento objetivo distinto del inmediato**, por poblado que esté (decisión 7 del ADR 0011).
- **Barras, medidores o cualquier cosa con forma de progreso** hacia el siguiente escalón. Vale también para el percentil: es una posición, no un avance.
- **Gráficas de la distribución del bracket.** El bloque 3 son tres cifras con su denominador; una curva de población invita a leer "dónde está la masa" y eso es #21, no esta página.
- **Datos de relleno, placeholders en gris, "coming soon" con cifras de ejemplo** (§1.5).
- **Formulario de aviso o de correo** (decisión 8 del ADR 0011, §25 del plan).
- **Perfiles de la temporada anterior** para que el bloque 4 no diga cero (decisión 6 del [ADR 0010](../decisions/0010-cobertura-por-segmento.md)).

### 2.7 Consecuencias

- **[#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18) recibe la página entera, no solo la caja.** Los cinco bloques de §2.3, con la caja ya cerrada en §1.
- **El bloque 3 necesita la distribución completa del bracket**, no solo el segmento objetivo: son todas las filas de `population_segments` de ese bracket en la corrida más reciente. Es carga nueva para [#61](https://github.com/Atorey/wow-pvp-intelligence/issues/61).
- **Hace falta una función nueva en `packages/core`** que dé la posición de un rating dentro de la distribución del bracket, con su recuento crudo y su umbral. La [`percentile()`](../../packages/core/src/stats.ts) que ya existe hace la operación inversa —el valor de un percentil dado— y no vale. No puede vivir en la web (regla 2 del proyecto).
- **[#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65) hereda dos componentes más**: la fila de cifra con denominador y el bloque de ausencia declarada.
- **[#26](https://github.com/Atorey/wow-pvp-intelligence/issues/26) tiene su suelo**: una página que solo contiene la explicación no se indexa (decisión 9 del ADR 0011). Las reglas finas siguen siendo suyas.
- **Esto no arregla el MVP, lo hace presentable.** Mientras #66 no corra, la caja está vacía en el 100 % de las visitas y el punto 6 de §25 del plan no se puede demostrar con el bloque 3.

---

## 3. Idioma, marca y tono de voz

### 3.1 Qué se decide aquí

Las §1 y §2 fijaron qué dice cada hueco de la pantalla dejando fuera **en qué idioma y con qué voz** lo dice ([#59](https://github.com/Atorey/wow-pvp-intelligence/issues/59)). Sin eso, cada string que se escriba a partir de ahora es una decisión tomada por omisión y repetida cientos de veces.

El reparto con `docs/decisions`: la parte estructural del bilingüe —prefijo de locale, slugs, `hreflang`, canonicalización y por qué el copy no puede vivir en `packages/core`— es del [ADR 0012](../decisions/0012-producto-bilingue.md), porque cambia rutas y capas. Aquí queda lo que se ve: **el idioma, el nombre, el tagline y las reglas de voz**.

### 3.2 El idioma del copy

**El producto se publica en inglés y en español desde el día 1, con el inglés como idioma fuente**: el copy se escribe primero en inglés y el español es traducción, nunca al revés ([ADR 0012](../decisions/0012-producto-bilingue.md)).

Para maquetar, tres consecuencias que se ven:

- **Los wireframes de §1 y §2 son la versión fuente**, no un marcador de posición. El layout no cambia entre idiomas; cambian los strings.
- **El español ocupa más y hay que maquetar para el largo, no para el corto.** `No comparison yet.` son 18 caracteres; `Todavía no hay comparación.` son 27, en cajas dibujadas a ~34 de ancho donde §23 prohíbe el scroll horizontal. Ningún componente puede depender de que el texto quepa en una línea.
- **La terminología del juego no se traduce en ninguna de las dos versiones**: `rating`, `gear`, `bracket`, `spec`, `item level`, `Solo Shuffle`, y los nombres de clase, especialización e item. La evidencia está en el propio plan, que llama a su persona principal "el que quiere subir de tier" (§4) sin traducir "tier".

### 3.3 El nombre — One Rung

**El producto se llama One Rung**, en el dominio **`onerung.io`**.

Un _rung_ es el peldaño de una escalera, y _ladder_ es el término nativo para las clasificaciones en competitivo. El nombre dice, literalmente, **un peldaño** — que es la promesa exacta del producto y una regla escrita: _"el objetivo por defecto es siempre el siguiente segmento, no la cima"_ (§13.5).

Por qué este y no otro:

- **Nombra el escalón, no la cima.** El ICP son los 1400-2200 (§4) y la persona principal es la que quiere subir un tier. Un nombre que evoca la élite —salón de la fama, campeón, gladiador— le dice a ese usuario "esto no es para ti" en la primera pantalla, y contradice §13.5 antes de que se cargue un solo dato.
- **No nombra el modo.** Un peldaño sirve igual para el rating de arena que para la puntuación de Mythic+, así que el nombre no cierra la puerta a PvE si algún día se abre. Los nombres de mapa de arena o de facción de BG sí la cerraban.
- **Cumple §7 sin excepciones**: corto, memorable, no empieza por `PvP-` y no contiene `-log` ni `-tracker`.
- **No usa IP de Blizzard.** Ni marca registrada, ni lore, ni nombre de logro. No hay nada que revisar antes de registrar.

**Sobre la extensión.** `.io` está en la lista de ccTLD que Google trata como genéricos —sin señal de país— junto a `.ai`, `.co`, `.me` y `.tv`; **`.gg` no está en esa lista**. Con §22 haciendo del SEO programático un canal de adquisición central y §39 contando la autoridad de dominio como moat que tarda años, un TLD que geolocaliza el sitio a Guernsey es un riesgo caro de deshacer. `.io` es además la convención de los competidores directos (Murlok.io, Raider.io).

### 3.4 Qué se descartó, y por qué

Anotado para no volver a proponerlo. Cada descarte es por una regla del producto, no por gusto:

| Familia                      | Ejemplos                                                  | Por qué no                                                                                                        |
| ---------------------------- | --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| **Nombra la cima**           | Hall of Champions, Feats of Strength, Champion, Gladiator | Contradice §13.5 y excluye al ICP en la primera palabra                                                           |
| **Suena a base de datos**    | Charbase, CombatDB                                        | §7 avisa expresamente de no sonar a "otra base de datos"                                                          |
| **Promete catálogo**         | Gearary, Talentary, Buildary, Classary                    | El producto **describe** lo que lleva el escalón de arriba, **no cataloga** (§1.8)                                |
| **Nombra lo que no tenemos** | Statforge                                                 | Las stats secundarias son la única categoría marcada como imposible en §1.2                                       |
| **Ata a un modo**            | Mugambala, Tolbarad, Frostwolf, Combatant                 | Cierran la puerta a PvE y atan la marca a una modalidad o una facción                                             |
| **Colisiona con Blizzard**   | Armoryx, Vaultara, Warband, Nexora, Arcanum               | _Armory_, _Great Vault_, _Warband_, _The Nexus_ y _arcano_ son terminología viva del juego o producto de Blizzard |
| **Promete resultado**        | The Climb                                                 | _Climb_ promete ascenso; el producto tiene prohibido prometer que algo sube el rating (§9.2)                      |

### 3.5 El tagline

§7 propone _"See what separates you from the players above you."_ Se ajusta a:

> **"See what separates you from the next rung."**
> **"Mira qué te separa del siguiente escalón."**

Hace el mismo trabajo, ata el nombre a la promesa y corrige una imprecisión: _"the players above you"_ es compatible con "la cima", y el objetivo por defecto es el **segmento inmediato** (§13.5). Ninguna de las dos versiones lleva verbo de recomendación ni promesa de resultado: _separates_ y _separa_ describen un estado, no un camino.

### 3.6 El tono de voz

Reglas verificables, no adjetivos. El tono aquí no es cosmético: es donde se cumple o se incumple el principio de correlación (§9.2).

1. **Declarativo, nunca imperativo.** El copy afirma lo que se ha medido. Ninguna frase de datos empieza por un verbo dirigido al usuario.
2. **La cifra primero, la lectura después.** "41% (128/312) up there" y debajo qué significa. Nunca la interpretación sola.
3. **La fracción manda, el porcentaje acompaña** (§2.5). Primero "1.598 de 2.282", después "percentil 70".
4. **Primera persona del plural para lo que es nuestro.** "We've only loaded the gear of 4 of them" — cuando la carencia es de muestreo se dice quién falla, no se pasiviza en "no hay datos disponibles".
5. **Nada de fechas ni de ETA** (§2.5). "It's filling in" es intención; "next week" es una promesa de calendario que no controlamos.
6. **Sin superlativos ni hype.** Ni "mejor", ni "óptimo", ni "definitivo". El producto no tiene una opinión sobre qué build es buena.
7. **La incertidumbre se declara, no se disculpa.** El estado `insufficient` no pide perdón ni promete: explica qué falta y cuánto (§1.5).
8. **"Observed", nunca "players"** (§2.5), con la definición a la vista una vez por página.

### 3.7 Reglas propias del español

El español rompe la no-causalidad más fácil que el inglés, y conviene tenerlo escrito antes de traducir el primer string:

- **"Para" + infinitivo introduce finalidad, y la finalidad es causalidad.** "Lo que lleva el 41% de 2000-2200" es correcto; "qué llevar para subir a 2000" es una traducción fluida y una violación de la regla 3 del proyecto. Lo mismo con el subjuntivo de finalidad ("para que subas").
- **Tuteo, nunca "usted".** Es el registro de la comunidad; el "usted" convierte una herramienta entre partidas en un informe bancario.
- **Español neutro**, sin voseo ni localismos: el público hispanohablante de WoW no está en un solo país.
- **Números a la española**: coma decimal y punto de millar ("1.598 de 2.282", "85,4 %"). En la versión inglesa, al revés. Es el detalle que delata una traducción hecha de prisa.
- **La terminología del juego se deja en inglés** (§3.2), incluso cuando exista traducción oficial en el cliente.

### 3.8 Qué no se dice nunca, en ninguno de los dos idiomas

- Verbos de recomendación en el copy de datos: _change_, _try_, _pick_, _should_, _cambia_, _prueba_, _deberías_.
- "Mejor build", "build óptima", "el meta correcto".
- Cualquier construcción que ligue una variable a un resultado de rating: _"raise your rating"_, _"para subir"_.
- Comparaciones contra el top 100 o contra la cima como objetivo (§13.5, §1.8).
- Promesas con fecha.

### 3.9 Consecuencias

- **[#20](https://github.com/Atorey/wow-pvp-intelligence/issues/20), [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25) y [#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65) quedan desbloqueadas.** Lo estructural que necesitan —rutas con locale, `hreflang`, indexación por locale— está en el [ADR 0012](../decisions/0012-producto-bilingue.md).
- **#20 hereda un requisito nuevo**: la página de metodología existe en las dos lenguas y es donde vive la definición de _observed_ que §2.5 exige tener a la vista.
- **#65 hereda el nombre y una restricción medible**: los componentes se tokenizan para el texto más largo de los dos idiomas (§3.2), no para el inglés.
- **Queda una acción fuera del repo**: registrar `onerung.io`. Al no haber IP de Blizzard de por medio, no hay revisión previa que hacer.
- **El tagline de §7 del plan queda sustituido** por el de §3.5. Es el único punto donde este documento corrige al plan en vez de desarrollarlo.
