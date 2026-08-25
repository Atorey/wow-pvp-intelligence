# Sistema visual

Los tokens y los componentes con los que se maquetan las pantallas del [brief](brief.md). Lo estructural —Tailwind, dónde viven los tokens, por qué no hay librería de componentes— está en el [ADR 0019](../decisions/0019-sistema-visual-en-css-con-tailwind.md); aquí están los **valores** y **qué se construye con ellos**.

La fuente de verdad de los valores es [`apps/web/src/app/globals.css`](../../apps/web/src/app/globals.css). Este documento explica **por qué** cada uno es el que es. Si los dos discrepan, manda el CSS y este documento está desactualizado.

---

## 1. La estética: la categoría, no la marca

El producto se parece al género —analítica competitiva de un juego oscuro y frío— y **no** al sitio de World of Warcraft. La diferencia no es de gusto: la cláusula 2.m de la ToU prohíbe que la aplicación aparente respaldo de Blizzard, y la decisión 8 del [ADR 0015](../decisions/0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) prohíbe el uso decorativo de su marca. Replicar su _trade dress_ —sus tipografías, sus texturas de pergamino y metal, sus marcos ornamentales— es la apariencia de respaldo que la cláusula señala, y además ninguna de esas tipografías es licenciable para esto.

Lo que sí se toma del género, y por qué cada cosa:

| Rasgo                            | Por qué está                                                                                                                 |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Fondo oscuro y frío**          | La categoría entera lo es y el ICP consulta entre partidas, con el cliente del juego al lado (#65)                           |
| **Acento oro sobrio**            | Un solo color de marca, en el titular y el enlace. Nunca portador único de un significado                                    |
| **Serif de capital romana**      | Es de donde viene el tono del género, con una tipografía de licencia abierta y no la de nadie                                |
| **Colores de calidad de item**   | Salen del dato (`character_snapshot_gear.quality`), no de la decoración. Son vocabulario del jugador, no marca               |
| **Nada de textura ni ornamento** | Un marco dorado alrededor de una cifra la convierte en un trofeo. Este producto describe una diferencia, no celebra un logro |

Y lo que no entra, anotado para no tener que discutirlo dos veces: logotipos ajenos, arte del juego, texturas, fondos ilustrados, marcos ornamentales, y cualquier tipografía de Blizzard. La lista completa de lo que no existe en la interfaz está en la [§4.6 del brief](brief.md#46-lo-que-no-va-a-existir-en-la-interfaz).

---

## 2. Color

### 2.1 Cómo está construida la paleta

Tres reglas, y las tres tienen consecuencias que se ven:

**Los tokens son semánticos.** `ink-secondary`, no `gray-400`. Un token con nombre de color no se puede reasignar al cambiar de tema sin quedar mintiendo, y el cambio de tema de este sistema es exactamente eso: reasignar.

**Cada token de texto cumple AA (4.5:1) contra las tres superficies**, no solo contra aquella para la que se eligió. Verificar contra la superficie buena fabrica una regla —"este morado, solo sobre esta superficie"— que al tercer componente no recuerda nadie. Los valores están resueltos contra el fondo **peor** de cada tema: el más claro en el oscuro, el más oscuro en el claro.

**No hay nivel "deshabilitado".** Tres niveles de texto y ninguno apagado. En este producto nada se pinta en gris flojo para sugerir que existe pero no está disponible: lo que no hay se declara con palabras ([§1.5 del brief](brief.md#15-los-tres-estados-de-confianza)), y lo que se declara se lee.

### 2.2 Superficies y texto

| Token           | Oscuro    | Claro     | Para qué                                                     |
| --------------- | --------- | --------- | ------------------------------------------------------------ |
| `bg`            | `#0e0f13` | `#f7f5f1` | El fondo de la página                                        |
| `surface`       | `#16181f` | `#ffffff` | La caja Player Gap y los bloques de sección                  |
| `raised`        | `#1e212a` | `#ffffff` | Una fila destacada dentro de una caja                        |
| `line`          | `#2a2e39` | `#dfdad1` | Separador entre bloques                                      |
| `line-strong`   | `#454b5c` | `#b4ada1` | Borde de una caja completa                                   |
| `ink`           | `#e8e6e1` | `#16181f` | La cifra y el nombre. Lo que se ha venido a leer             |
| `ink-secondary` | `#a8aab4` | `#5a5e6b` | La lectura que acompaña a la cifra, y la línea de atribución |
| `ink-muted`     | `#868a97` | `#666a77` | Etiquetas de campo y sujeto de la caja                       |
| `accent`        | `#c8a25a` | `#8a6a22` | Titular de sección y enlaces                                 |
| `accent-quiet`  | `#8a7440` | `#a89263` | Filete y detalle no textual                                  |
| `focus`         | `#e2b23c` | `#8a6a22` | Anillo de foco                                               |

En el tema claro `surface` y `raised` son los dos blancos: la elevación la lleva el borde, no un blanco más blanco que el blanco. Los separadores son decorativos —la jerarquía la llevan el tamaño y el espacio— y por eso no se les exige el 3:1 de componente; **al anillo de foco sí**, porque es información de estado.

### 2.3 Calidad de item

Sale del dato, no de la decoración, y por eso está tokenizada en vez de escrita en el componente.

| Calidad     | Canónico  | Oscuro    | Claro     |
| ----------- | --------- | --------- | --------- |
| `poor`      | `#9d9d9d` | `#9d9d9d` | `#707070` |
| `common`    | `#ffffff` | = `ink`   | = `ink`   |
| `uncommon`  | `#1eff00` | `#1eff00` | `#0f8200` |
| `rare`      | `#0070dd` | `#0c87ff` | `#006dd8` |
| `epic`      | `#a335ee` | `#b65ff2` | `#a233ee` |
| `legendary` | `#ff8000` | `#ff8000` | `#b05800` |
| `artifact`  | `#e6cc80` | `#e6cc80` | `#896d1b` |

Dos cosas que conviene tener escritas antes de que alguien las "corrija" comparando con una captura del cliente:

- **El azul y el morado canónicos no cumplen AA sobre `raised`** (3,68 y 3,63). Los que se pintan son las variantes más cercanas en luminosidad que pasan sobre cualquier superficie del tema. Es un desvío deliberado y está anotado con su ratio en el CSS.
- **`common` no es blanco: es el color de texto del tema.** "Común" es la ausencia de tinte, no un gris elegido — y en el tema claro el blanco canónico sería invisible.

**El color de calidad nunca es el único portador de nada.** El nombre del item es la información; el tinte acompaña. Un jugador que no distinga el morado del azul recibe exactamente el mismo dato.

### 2.4 Aviso de muestra reducida

`warn`, `warn-surface` y `warn-line` son solo del estado `medium` de la caja Player Gap. **No** son un sistema de severidad y no hay `error`, `success` ni `info`: este producto no tiene nada que celebrar en verde ni nada que alarmar en rojo. Lo único que avisa es que una muestra es pequeña, y eso ya tiene su bloque.

El color de ese bloque **no informa por sí solo** ([§1.7 del brief](brief.md#17-reglas-que-la-caja-hereda-y-no-puede-relajar)). Lo que comunica el aviso es que ocupa espacio, desplaza al resto y lleva texto que lo dice. Sin distinguir colores se recibe la misma información.

---

## 3. Tipografía

| Token          | Familia                               | Para qué                                         |
| -------------- | ------------------------------------- | ------------------------------------------------ |
| `font-display` | Cinzel 600, reserva serif del sistema | `h1`–`h3` y los titulares en versal de las cajas |
| `font-sans`    | Pila del sistema                      | Todo lo demás                                    |

**Cinzel** es una serif de capital romana con licencia OFL. Está por el tono del género, y **solo** para titulares: en tamaños de cuerpo se lee peor que la pila del sistema y no compensa. Se auto-aloja con `next/font`, así que ni depende de un dominio ajeno en tiempo de ejecución ni le cuenta a nadie que ha habido una visita ([ADR 0019](../decisions/0019-sistema-visual-en-css-con-tailwind.md), decisión 8). Si no carga, la reserva mantiene el tono serif y el layout no salta.

El texto de cuerpo usa la pila del sistema: cero bytes, cero peticiones, y el aspecto nativo del dispositivo desde el que se consulta entre partidas.

### 3.1 La escala

| Paso        | Tamaño | Para qué                                                 |
| ----------- | ------ | -------------------------------------------------------- |
| `text-xs`   | 14px   | Suelo del sistema. La línea de atribución, las etiquetas |
| `text-sm`   | 15px   | La lectura que acompaña a una cifra                      |
| `text-base` | 16px   | Cuerpo                                                   |
| `text-lg`   | 18px   | Cifra de contexto                                        |
| `text-xl`   | 22px   | Titular de la caja Player Gap                            |
| `text-2xl`  | 28px   | `h1` de página                                           |

**No existe ningún paso por debajo de 14px, y es a propósito.** La [§4.3 del brief](brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua) exige que la línea de atribución sea "texto de cuerpo, no letra pequeña", porque la cláusula 2.m pide que sea _conspicua_. La forma de cumplirlo que no depende de que nadie se despiste es no tener con qué incumplirlo: no hay token de 12px. Los pasos redefinen `text-xs` y `text-sm` de Tailwind en vez de añadir nombres nuevos, para que el `text-xs` de la documentación de Tailwind no signifique aquí otra cosa.

### 3.2 Cifras

`font-variant-numeric: tabular-nums` está en el `body` y no se quita. Las cifras de este producto se leen **en columna** —porcentajes, fracciones, item levels, uno debajo de otro en la lista de diferencias— y con numerales proporcionales bailan de fila a fila. Es la diferencia entre una lista que se escanea y una que hay que leer.

### 3.3 Versalitas

Los titulares de caja van en versal con `tracking-caps` (0.08em), como en los wireframes del brief. Se escriben en minúscula en el marcado y se transforman con `uppercase`: un lector de pantalla debe leer "What separates you from 2000+?", no deletrear las mayúsculas.

---

## 4. Espaciado y medida

Escala de Tailwind con base 4px, sin ampliar. Los pasos que se usan de verdad son `2` (0.5rem) dentro de una fila, `4` (1rem) entre filas, `5` (1.25rem) de relleno de caja y `6`–`8` entre bloques de página.

`max-w-measure` = **34rem**. Es el ancho al que están dibujados los wireframes del brief y el ancho de lectura del contenido. El móvil es el caso de diseño y no la adaptación (§23 del plan): los componentes se maquetan a esta medida y crecen desde ahí, nunca al revés.

**Dos restricciones de tamaño que vienen del contenido, no del gusto:**

- **Ningún componente puede depender de que un texto quepa en una línea.** El español ocupa más que el inglés —`No comparison yet.` son 18 caracteres, `Todavía no hay comparación.` son 27— y todo se maqueta para el largo ([§3.2 del brief](brief.md#32-el-idioma-del-copy)). Nada lleva `truncate` ni `ellipsis`.
- **Nada de scroll horizontal**, tampoco dentro de un bloque. Es lo que descarta las tablas densas en el componente central.

---

## 5. Componentes

Están **especificados aquí y construidos en [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) y [#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18)**. Cada uno viene de una decisión del brief; la columna "de dónde sale" es lo que impide que se rediseñen por gusto.

| Componente          | Qué es                                                                     | De dónde sale                                                                                                               |
| ------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PlayerGapBox`      | La caja, con **tres layouts** según `canShowComparison()`                  | [§1.3](brief.md#13-decisión--la-caja-es-una-lista-no-un-panel-de-barras), [§1.5](brief.md#15-los-tres-estados-de-confianza) |
| `DifferenceRow`     | Una diferencia de gear: nombre, slot, las dos adopciones con su fracción   | [§1.3](brief.md#13-decisión--la-caja-es-una-lista-no-un-panel-de-barras) punto 4                                            |
| `SmallSampleNotice` | El bloque de aviso de `medium`, que ocupa espacio y desplaza               | [§1.5](brief.md#15-los-tres-estados-de-confianza)                                                                           |
| `NoComparisonBlock` | Lo que **sustituye** al contenido en `insufficient`, con sus dos causas    | [§1.5](brief.md#15-los-tres-estados-de-confianza)                                                                           |
| `CountedFigure`     | Una cifra con su denominador: la fracción manda, el porcentaje acompaña    | [§2.5](brief.md#25-reglas-de-copy-del-bloque-descriptivo)                                                                   |
| `DeclaredAbsence`   | Una línea por ausencia, con su causa y su denominador. Sin fechas          | [§2.3](brief.md#23-los-bloques-en-orden) bloque 4                                                                           |
| `GearRow`           | Item con hueco de icono **reservado**: sin icono, la fila no se recoloca   | [§4.5](brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono)                                                        |
| `AttributionFooter` | La línea de atribución y no afiliación, en el layout, en todas las páginas | [§4.2](brief.md#42-la-línea-en-las-dos-lenguas), [§4.3](brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua)                  |

### 5.1 Los tres estados no son tres variantes de estilo

Es la regla que más fácil se incumple al maquetar, así que se escribe aparte. `PlayerGapBox` **no** es una caja con una prop `confidence` que cambia un borde: son tres composiciones distintas.

- **`high`** — el contenido completo.
- **`medium`** — el mismo contenido **más** un bloque que ocupa espacio antes de las cifras. Si el aviso se puede pasar por alto haciendo scroll rápido, no cumple "aviso visible" (§13.4 del plan).
- **`insufficient`** — el contenido **se sustituye** por la explicación. Ni lista recortada, ni barras a cero, ni cifras en gris de muestra, ni "coming soon". La caja **mantiene su sitio y su tamaño** encima del pliegue: desaparecer no explica nada.

Quien decide es `canShowComparison()` de `packages/core`, y el `n` que manda es el `gear_sample` del segmento objetivo, no su `sample_size` ([ADR 0010](../decisions/0010-cobertura-por-segmento.md), decisión 3). La UI obedece: aquí no hay ningún umbral.

### 5.2 Lo que ningún componente hace

- **Barras de progreso o medidores**, de cualquier tipo, incluida una sola ([§1.4 del brief](brief.md#14-por-qué-no-barras)). Vale también para el percentil: es una posición, no un avance.
- **Tooltips con la muestra dentro.** El `n` va pegado al porcentaje y siempre visible (§13.5 del plan).
- **Truncar texto.** Ver §4.
- **Comunicar un estado solo con color.** Vale para la confianza, para la calidad de item y para los enlaces, que conservan el subrayado.
- **Quitar el anillo de foco.** Está definido una vez en la base y ningún componente lo pisa.
- **Tablas densas** en el componente central.

---

## 6. Cómo se verifica

Lo que se puede comprobar sin criterio humano, se comprueba solo. [`contrast.test.ts`](../../apps/web/src/design/contrast.test.ts) lee `globals.css` y falla si:

- un token de texto o de calidad no llega a 4.5:1 contra alguna de las tres superficies de su tema;
- el texto del aviso no llega a 4.5:1 sobre su propia superficie;
- el anillo de foco no llega a 3:1 contra alguna superficie;
- `quality-common` deja de ser el color de texto del tema;
- aparece un paso tipográfico por debajo de 14px.

Corre con `npm test`. Los ratios anotados junto a cada token dicen lo que se midió el día que se eligió el color; el test dice lo que vale hoy.

**Lo que el test no puede ver** y hay que mirar a mano: que los tres estados sean tres layouts y no tres colores, que el aviso de `medium` de verdad desplace al contenido, y que la línea de atribución quepa en tres líneas de móvil en español sin truncar.
