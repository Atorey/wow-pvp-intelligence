# Design brief

Dónde se deciden las cosas que se ven. Los ADR de `docs/decisions` son de arquitectura; meter ahí "el tema es oscuro" los diluye, así que las decisiones de pantalla, jerarquía y estados viven aquí ([#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65)).

Hoy este documento contiene una sola sección: **el contenido de la caja Player Gap**, que era lo que bloqueaba al resto ([#57](https://github.com/Atorey/wow-pvp-intelligence/issues/57)). El sistema visual —tokens, tipografía, tema, componentes— es #65 y aún no está escrito.

> **El idioma del copy está sin decidir (#59).** Los textos de los wireframes se escriben en inglés, como el copy del plan (§13.1, §13.6), y son **provisionales**. Lo que este documento fija es la estructura de la caja y **qué dice cada hueco**, no en qué idioma lo dice. Cuando #59 decida, se traducen los strings sin tocar el layout.

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

**El n que manda es el `gear_sample` del segmento objetivo, no su `sample_size`** (decisión 3 del [ADR 0010](../decisions/0010-cobertura-por-segmento.md)). Población no es base de comparación: hoy hay 357 segmentos con n≥30 de población y `gear_sample = 0` en todos.

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
│ [qué más se le ofrece → #58]     │
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
│ [qué más se le ofrece → #58]     │
└──────────────────────────────────┘
```

Los dos wireframes acaban en el mismo hueco: **qué más se le ofrece a ese jugador en el resto de la página es alcance de [#58](https://github.com/Atorey/wow-pvp-intelligence/issues/58)**, no de esta decisión. Aquí se fija qué ocupa la caja; #58 decide qué la rodea y si hay que revisar el ADR 0007.

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

- **[#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18) queda desbloqueada** con el contenido cerrado: una lista y dos cifras de contexto, en tres layouts.
- **#18 necesita distinguir las dos causas de §1.5.** Hoy el `reason` de `PlayerGapUnavailable` dice "no hay suficientes jugadores muestreados en X" para los dos casos, y son distintos: uno es población que no existe, el otro es muestreo que nos falta. La distinción es de copy y de dato (`sample_size` frente a `gear_sample`), y sale de `population_segments` sin trabajo nuevo.
- **[#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65) hereda componentes concretos que tokenizar**, no un mockup por decidir: fila de diferencia, bloque de aviso y bloque de sustitución.
- **[#24](https://github.com/Atorey/wow-pvp-intelligence/issues/24) tiene sitio reservado y ninguna forma que romper.** Cuando los talentos se decodifiquen en nodos, cada nodo es una variable más de la misma lista, con la misma fila. No hay que rediseñar la caja para meterlos: era la otra ventaja de no tener barras por categoría.
- **Queda por vigilar la lectura del gear alignment.** La inversión de §1.4 está medida sobre tres personajes; cuando [#66](https://github.com/Atorey/wow-pvp-intelligence/issues/66) traiga muestra de verdad hay que volver a mirarla, porque si se confirma, la cifra de contexto tampoco se sostiene y la caja se queda con item level y la lista.
