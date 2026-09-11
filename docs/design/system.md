# Sistema visual

Los tokens y los componentes con los que se maquetan las pantallas del [brief](brief.md). Lo estructural —Tailwind y dónde viven los tokens— está en el [ADR 0019](../decisions/0019-sistema-visual-en-css-con-tailwind.md), y qué librería de componentes se usa, en el [ADR 0025](../decisions/0025-componentes-con-shadcn-ui.md); aquí están los **valores** y **qué se construye con ellos**.

Desde el ADR 0025 los componentes son **shadcn/ui**, copiados al repo en [`apps/web/src/components/ui/`](../../apps/web/src/components/ui/), y los tokens se llaman como los llama shadcn. Es un cambio de nombres y no de paleta: los valores verificados son los mismos que antes, con dos excepciones que están anotadas donde toca.

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

**El vocabulario es el de shadcn, y lo que le falta se añade con su gramática.** Sus nombres describen roles de componente —`card`, `popover`, `muted-foreground`, `ring`— y cubren el cromo de una aplicación cualquiera. Tres cosas de este producto no las tiene, y son las únicas tres que lo extienden:

| Lo que añadimos                                   | Por qué no sirve lo suyo                                                                                                          |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `subtle-foreground`                               | shadcn tiene dos niveles de texto y aquí hacen falta tres, por la regla de arriba                                                 |
| `warning`, `warning-foreground`, `warning-border` | Lo único parecido es `destructive`, y una muestra pequeña no es un fallo ([ADR 0003](../decisions/0003-umbrales-de-confianza.md)) |
| `quality-*` y `class-*`                           | Salen del dato, no de la decoración. Ninguna librería los tiene ni los va a tener                                                 |

Un cuarto token propio no se añade sin revisar el [ADR 0025](../decisions/0025-componentes-con-shadcn-ui.md): la gracia de adoptar un vocabulario ajeno se pierde en cuanto la mitad es nuestra.

**Cuidado con `accent`.** Antes del ADR 0025 era el oro de marca; en shadcn es el fondo tenue de hover y de opción resaltada. El oro ahora se llama `primary`.

### 2.2 Superficies y texto

| Token               | Antes           | Oscuro    | Claro     | Para qué                                                     |
| ------------------- | --------------- | --------- | --------- | ------------------------------------------------------------ |
| `background`        | `bg`            | `#0e0f13` | `#f7f5f1` | El fondo de la página                                        |
| `card`              | `surface`       | `#16181f` | `#ffffff` | La caja Player Gap y los bloques de sección                  |
| `popover`           | `surface`       | `#16181f` | `#ffffff` | Lo que flota encima: desplegables y menús                    |
| `secondary`         | `raised`        | `#1e212a` | `#f7f5f1` | Una fila destacada dentro de una caja                        |
| `muted`             | `raised`        | `#1e212a` | `#f7f5f1` | Un bloque apagado                                            |
| `accent`            | `raised`        | `#1e212a` | `#f7f5f1` | Hover y opción resaltada. **No es el color de marca**        |
| `border`            | `line`          | `#2a2e39` | `#dfdad1` | Separador entre bloques                                      |
| `input`             | `line-strong`   | `#454b5c` | `#b4ada1` | Borde de un campo y de una caja completa                     |
| `foreground`        | `ink`           | `#e8e6e1` | `#16181f` | La cifra y el nombre. Lo que se ha venido a leer             |
| `muted-foreground`  | `ink-secondary` | `#a8aab4` | `#5a5e6b` | La lectura que acompaña a la cifra, y la línea de atribución |
| `subtle-foreground` | `ink-muted`     | `#868a97` | `#666a77` | Etiquetas de campo y sujeto de la caja                       |
| `primary`           | `accent`        | `#c8a25a` | `#8a6a22` | El oro de marca: titular de sección y enlaces                |
| `destructive`       | —               | `#ef5f74` | `#b3243f` | Nada, todavía. Ver abajo                                     |
| `ring`              | `focus`         | `#e2b23c` | `#8a6a22` | Anillo de foco                                               |

Cada relleno tiene su `-foreground`, que es el color del texto que va encima, y el test los verifica por pares. Los separadores son decorativos —la jerarquía la llevan el tamaño y el espacio— y por eso no se les exige el 3:1 de componente; **al anillo de foco sí**, porque es información de estado.

Dos cosas de esta tabla no son un renombrado:

- **`accent` en el tema claro ya no es blanco.** Valía `#ffffff`, igual que `card`, así que el resaltado de la opción activa se pintaba blanco sobre blanco. Con un solo desplegable propio apenas se notaba; convertido en el fondo de hover de todos los componentes de shadcn sería el estado de foco de ratón del sitio entero. Pasa a ser el gris del fondo de página, que es el único escalón que queda cuando la tarjeta ya es blanca. El test lo fija: `accent` y `card` no pueden coincidir.
- **`destructive` es de shadcn y no lo usa ninguna pantalla.** El producto no tiene ninguna acción destructiva. Tiene valor para que las variantes de sus componentes no queden sin resolver, y se le exige el mismo contraste que a todo lo demás.

**`accent-quiet` ya no existe.** No lo usaba ningún componente y no tiene sitio en el vocabulario de shadcn; mantenerlo habría sido el cuarto token propio que la §2.1 dice que no hay.

### 2.3 Calidad de item

Sale del dato, no de la decoración, y por eso está tokenizada en vez de escrita en el componente.

| Calidad     | Canónico  | Oscuro    | Claro     |
| ----------- | --------- | --------- | --------- |
| `poor`      | `#9d9d9d` | `#9d9d9d` | `#707070` |
| `common`    | `#ffffff` | = `fg`    | = `fg`    |
| `uncommon`  | `#1eff00` | `#1eff00` | `#0f8200` |
| `rare`      | `#0070dd` | `#0c87ff` | `#006dd8` |
| `epic`      | `#a335ee` | `#b65ff2` | `#a233ee` |
| `legendary` | `#ff8000` | `#ff8000` | `#b05800` |
| `artifact`  | `#e6cc80` | `#e6cc80` | `#896d1b` |

Dos cosas que conviene tener escritas antes de que alguien las "corrija" comparando con una captura del cliente:

- **El azul y el morado canónicos no cumplen AA sobre `raised`** (3,68 y 3,63). Los que se pintan son las variantes más cercanas en luminosidad que pasan sobre cualquier superficie del tema. Es un desvío deliberado y está anotado con su ratio en el CSS.
- **`common` no es blanco: es el color de texto del tema** (`fg` en la tabla es `foreground`). "Común" es la ausencia de tinte, no un gris elegido — y en el tema claro el blanco canónico sería invisible.

**El color de calidad nunca es el único portador de nada.** El nombre del item es la información; el tinte acompaña. Un jugador que no distinga el morado del azul recibe exactamente el mismo dato.

### 2.4 Aviso de muestra reducida

`warning` (el fondo), `warning-foreground` (el texto) y `warning-border` son solo del estado `medium` de la caja Player Gap. **No** son un sistema de severidad y no hay `error`, `success` ni `info`: este producto no tiene nada que celebrar en verde ni nada que alarmar en rojo. Lo único que avisa es que una muestra es pequeña, y eso ya tiene su bloque.

**No se reutiliza el `destructive` de shadcn**, aunque exista y sea el rojo que cualquier librería usaría aquí. Una muestra pequeña no es un fallo ([ADR 0003](../decisions/0003-umbrales-de-confianza.md)): el bloque dice sobre cuántos casos está calculada una comparación, y pintarlo del rojo de error afirma lo contrario que el texto que tiene al lado. Cuando el color y el copy se contradicen, gana el color.

El color de ese bloque **no informa por sí solo** ([§1.7 del brief](brief.md#17-reglas-que-la-caja-hereda-y-no-puede-relajar)). Lo que comunica el aviso es que ocupa espacio, desplaza al resto y lleva texto que lo dice. Sin distinguir colores se recibe la misma información.

### 2.5 Clase del personaje

Mismo criterio que la calidad de item, y por la misma razón: sale del dato (`class_slug`), es vocabulario que el jugador ya lee de un vistazo y no es marca ajena usada como decoración. Trece tokens, `--color-class-*`.

| Clase          | Canónico  | Oscuro    | Claro     |
| -------------- | --------- | --------- | --------- |
| `death-knight` | `#c41e3a` | `#e5566e` | `#c41e3a` |
| `demon-hunter` | `#a330c9` | `#bc62d9` | `#a330c9` |
| `druid`        | `#ff7c0a` | `#ff7c0a` | `#b55400` |
| `evoker`       | `#33937f` | `#349782` | `#2c7d6c` |
| `hunter`       | `#aad372` | `#aad372` | `#577b26` |
| `mage`         | `#3fc7eb` | `#3fc7eb` | `#107a97` |
| `monk`         | `#00ff98` | `#00ff98` | `#00814d` |
| `paladin`      | `#f48cba` | `#f48cba` | `#d9156c` |
| `priest`       | `#ffffff` | = `fg`    | = `fg`    |
| `rogue`        | `#fff468` | `#fff468` | `#7b7200` |
| `shaman`       | `#0070dd` | `#0b87ff` | `#006eda` |
| `warlock`      | `#8788ee` | `#8788ee` | `#5e5fe8` |
| `warrior`      | `#c69b6d` | `#c69b6d` | `#93683a` |

Tres cosas que conviene tener escritas antes de que alguien las "corrija" comparando con el juego:

- **En el tema oscuro ocho de los trece son el canónico**, porque el canónico está pensado justo para eso: leerse sobre el fondo negro del cliente. **En el claro casi ninguno sobrevive.** El amarillo de `rogue` y el verde de `monk` sobre `#f7f5f1` están en 1,3 y 1,6; lo que se pinta es la variante más cercana en luminosidad que llega a AA.
- **`priest` no tiene color propio.** Su canónico es el blanco, que en el tema claro solo alcanza AA convertido en un gris que además coincide con `quality-poor`. Un color de clase que no distingue la clase no es un color de clase: se pinta con `foreground`, la misma decisión que `quality-common`.
- **Sin clase observada no se adivina ninguna.** `null` es "no disponible" (regla 5 del proyecto) y el nombre se pinta en `foreground`, no apagado: lo que falta es la observación, y no es del personaje la culpa.

**El color de clase nunca es el único portador de nada**, igual que el de calidad. El nombre y la spec están escritos; el tinte acompaña.

La correspondencia con las utilidades de Tailwind está en [`apps/web/src/design/class-color.ts`](../../apps/web/src/design/class-color.ts), escrita entera y a mano: Tailwind lee el código como texto y un `text-class-${slug}` no generaría ninguna utilidad, así que el nombre se pintaría sin color y sin error en ninguna parte.

### 2.6 Cómo se cambia de tema

El tema lo lleva **una clase en el `<html>`**, que la pone [`next-themes`](../../apps/web/src/components/theme-provider.tsx), y hay un conmutador visible en el pie. Antes del [ADR 0025](../decisions/0025-componentes-con-shadcn-ui.md) lo decidía una media query y no había forma de llevarle la contraria al sistema.

Tres detalles que no se adivinan:

- **El oscuro va en `:root, .dark` y el claro en `.light`**, al revés de como lo escribe shadcn. Su convención pone el claro en `:root` a secas, y eso lo convertiría en lo que se pinta mientras no hay clase — la primera pintura, y el visitante sin JavaScript. El oscuro es el de por defecto (decisión 4 del [ADR 0019](../decisions/0019-sistema-visual-en-css-con-tailwind.md)) y sigue siéndolo.
- **`next-themes` inyecta un script que corre antes de la primera pintura.** Sin él la página se pinta con el tema de por defecto y salta al elegido al hidratar. Es también la razón del `suppressHydrationWarning` del `<html>`, y es el único sitio del sitio donde está puesto.
- **Un `dark:` en un componente sigue siendo un error**, también dentro de `components/ui/`. El tema se cambia reasignando variables; duplicar la decisión de color en el marcado deja que los dos temas diverjan sin que nadie lo note, y rompe que el test pueda verificarlos leyendo un solo fichero. La variante está declarada en `globals.css` para que un `dark:` que se cuele sea redundante en vez de dispararse por un criterio distinto al del resto de la página.

### 2.7 La textura del fondo

El fondo de página no es un color plano. Lleva dos capas por debajo de todo, y las dos son decoración: no portan ningún significado y ninguna cifra depende de ellas.

- **La veladura** (`--texture-veil`), en el fondo del `body` y con `background-attachment: fixed`. Es una luz cálida arriba —`primary` a un 7-8%, un porcentaje al que ya no se lee como color— y una viñeta abajo. Sale de `color-mix` sobre los tokens y no de un hex propio, así que sigue a la marca si el oro cambia. Va fija porque una viñeta que se desliza con el scroll se lee como una capa suelta encima del contenido.
- **La piedra** (`--texture-grain`), en `body::before`. Son dos `feTurbulence` grises dentro de un mismo SVG embebido: uno de frecuencia baja, que es el que se reconoce como pared, y otro fino, que le quita el aire de degradado. Con el fino a secas queda ruido de sensor; con el grueso a secas, un mapa de nubes. Comparten tesela de 800px porque en dos capas de `background` cada una llevaría su tamaño y se repetirían con dos ritmos distintos, que es justo lo que se nota.

Tres cosas que no se adivinan:

- **`stitchTiles` no basta por sí solo.** Cose el ruido sobre la _región del filtro_, que por defecto es un 10% mayor que el elemento, así que el punto donde empalma no cae donde empalma la tesela y la rejilla de repetición se ve a simple vista. La región va clavada a los 800px con `filterUnits='userSpaceOnUse'`; quitarlo devuelve la cuadrícula.
- **No hay ningún fichero de imagen.** El SVG va embebido en el token, así que no hay petición extra en la primera pintura ni un JPEG que se vea a bandas sobre el degradado. La contrapartida es que el efecto se ajusta con dos números —`baseFrequency` y el `opacity` de cada `rect`—, no abriendo Photoshop.
- **La intensidad es un token por tema y no el mismo valor.** El ruido es gris neutro: sobre el fondo oscuro aclara y sobre el claro oscurece, y a la misma opacidad el tema claro se lee como suciedad. De ahí `--texture-grain-opacity`, 0.07 en oscuro y 0.045 en claro.
- **`z-index: -1` en `body::before` no es un número arbitrario.** El fondo del `body` se propaga al lienzo y se pinta antes que cualquier descendiente, así que la piedra cae encima de la veladura; y por ser negativo cae debajo del contenido, incluida la barra lateral, que es un hijo de flex sin posicionar y sin él quedaría tapada.

Con `prefers-contrast: more` se retiran las dos enteras. Es decoración, así que se quita en vez de atenuarse.

### 2.8 La barra de desplazamiento

Es la única pieza de interfaz que el navegador pinta con su propia paleta, y se nota justo donde más: la barra lateral desborda en cuanto la ventana es baja, y ahí aparecía una barra clara de sistema pegada a `card`. Se pinta con tokens —`input` el pulgar, `subtle-foreground` al pasar por encima, carril transparente— así que cambia con el tema sin una regla más.

Está declarada **dos veces en `globals.css`, y no son alternativas que compitan**: Chromium actual, Firefox y Safari 18.2+ entienden `scrollbar-color` e **ignoran** las reglas `::-webkit-scrollbar` en cuanto está puesta; los WebKit anteriores hacen lo contrario. Cada navegador aplica una y no ve la otra. Borrar "la duplicada" deja sin estilo a la mitad de los navegadores.

---

## 3. Tipografía

Tres familias con tres trabajos distintos.

| Token          | Familia                                 | Para qué                                 |
| -------------- | --------------------------------------- | ---------------------------------------- |
| `font-brand`   | Cinzel 600, reserva serif del sistema   | **Solo** el nombre del producto          |
| `font-display` | Oswald 500, reserva condensada          | `h1`–`h3` y las etiquetas en versal      |
| `font-sans`    | Roboto 400/500/700, reserva del sistema | Todo lo demás: cuerpo, cifras, controles |

**Cinzel** es una serif de capital romana con licencia OFL, y es la firma. Sobrevive al cambio de las otras dos porque no es un paso de la escala: un titular en la tipografía de marca convierte cada encabezado en un logotipo, y por eso la regla base de `h1`–`h3` **no** la usa.

**Oswald** es condensada y se sirve en un solo peso. Un titular se distingue aquí por su ancho y su caja, no por engordar; el peso está fijado en la regla base para que el navegador no sintetice una negrita falsa donde el marcado trae un `strong`.

Las tres se auto-alojan con `next/font`, así que ninguna depende de un dominio ajeno en tiempo de ejecución ni le cuenta a nadie que ha habido una visita ([ADR 0019](../decisions/0019-sistema-visual-en-css-con-tailwind.md), decisión 8). Cada una carga los pesos que usa y ni uno más: un peso de sobra son decenas de kilobytes en la primera pintura de la portada, que es la página que alguien abre sin haber decidido todavía si se queda. Si una no carga, su reserva mantiene la clase —serif, condensada, grotesca— y el layout no salta.

### 3.1 La escala

| Paso        | Tamaño | Para qué                                                 |
| ----------- | ------ | -------------------------------------------------------- |
| `text-xs`   | 14px   | Suelo del sistema. La línea de atribución, las etiquetas |
| `text-sm`   | 15px   | La lectura que acompaña a una cifra                      |
| `text-base` | 16px   | Cuerpo                                                   |
| `text-lg`   | 18px   | Cifra de contexto                                        |
| `text-xl`   | 22px   | Titular de la caja Player Gap                            |
| `text-2xl`  | 28px   | `h1` de página                                           |
| `text-3xl`  | 36px   | El titular de la portada, y solo ése                     |

**No existe ningún paso por debajo de 14px, y es a propósito.** La [§4.3 del brief](brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua) exige que la línea de atribución sea "texto de cuerpo, no letra pequeña", porque la cláusula 2.m pide que sea _conspicua_. La forma de cumplirlo que no depende de que nadie se despiste es no tener con qué incumplirlo: no hay token de 12px. Los pasos redefinen `text-xs` y `text-sm` de Tailwind en vez de añadir nombres nuevos, para que el `text-xs` de la documentación de Tailwind no signifique aquí otra cosa.

### 3.2 Cifras

`font-variant-numeric: tabular-nums` está en el `body` y no se quita. Las cifras de este producto se leen **en columna** —porcentajes, fracciones, item levels, uno debajo de otro en la lista de diferencias— y con numerales proporcionales bailan de fila a fila. Es la diferencia entre una lista que se escanea y una que hay que leer.

### 3.3 Versalitas

Los titulares de caja y de sección van en versal con `tracking-caps` (0.08em), como en los wireframes del brief. Se escriben en minúscula en el marcado y se transforman con `uppercase`: un lector de pantalla debe leer "What separates you from 2000+?", no deletrear las mayúsculas. En español la transformación **conserva los acentos** —"QUÉ SE JUEGA AHORA"—, que es lo que pide la RAE y lo que hace el navegador sin ayuda.

### 3.4 El acento dentro de un titular

El titular de la portada lleva una parte en `accent` y el resto en `ink`. Dos reglas lo acotan, y las dos son la misma de siempre escrita para este caso:

- **El color no es lo único que marca esa parte.** La frase se entiende igual leída entera y en un solo color; el acento no añade información, la subraya. Es la misma regla que gobierna la calidad de item y la clase.
- **La partición vive en el diccionario, no en el componente.** El titular está guardado en dos claves (`home.title.lead` y `home.title.highlight`) porque en cada lengua la parte que importa cae en otro sitio de la frase. Un `slice()` por posición o una marca dentro del string se rompen con la primera traducción, y se rompen en silencio.

Es el **único** sitio donde un titular se parte en dos colores. Si aparece un segundo, deja de leerse como énfasis y pasa a leerse como una categoría que el lector tiene que descifrar.

---

## 4. Espaciado y medida

Escala de Tailwind con base 4px, sin ampliar. Los pasos que se usan de verdad son `2` (0.5rem) dentro de una fila, `4` (1rem) entre filas, `5` (1.25rem) de relleno de caja y `6`–`8` entre bloques de página.

Dos anchos, con dos trabajos distintos:

| Token           | Valor   | Para qué                                                         |
| --------------- | ------- | ---------------------------------------------------------------- |
| `max-w-measure` | 34rem   | Lo que se lee seguido: metodología, estados de error, un párrafo |
| `max-w-page`    | 76rem   | La columna principal de una página que es un tablero             |
| `w-sidebar`     | 15.5rem | La barra lateral, a partir de `lg`                               |

`max-w-measure` es el ancho al que están dibujados los wireframes del brief y el ancho de lectura del contenido. El móvil sigue siendo el caso de diseño y no la adaptación (§23 del plan): los componentes se maquetan a esta medida y crecen desde ahí, nunca al revés — **incluida la portada**, cuyo hero y cuyo copy siguen limitados a `measure` aunque la columna que los contiene sea más ancha.

`max-w-page` existe porque la portada no es una lectura: es un tablero con una tabla de specs que a 34rem no cabe de ninguna manera. Un ancho de página **no** es permiso para que un párrafo lo ocupe.

La barra lateral solo es una columna a partir de `lg`. Por debajo es la barra superior, con el mismo marcado doblado de columna a fila: dos marcados divergen en cuanto se toca uno de los dos.

**Dos restricciones de tamaño que vienen del contenido, no del gusto:**

- **Ningún componente puede depender de que un texto quepa en una línea.** El español ocupa más que el inglés —`No comparison yet.` son 18 caracteres, `Todavía no hay comparación.` son 27— y todo se maqueta para el largo ([§3.2 del brief](brief.md#32-el-idioma-del-copy)). Nada lleva `truncate` ni `ellipsis`.
- **Nada de scroll horizontal**, tampoco dentro de un bloque. Es lo que descarta las tablas densas en el componente central.

---

## 5. Componentes

### 5.0 De dónde sale cada uno

Desde el [ADR 0025](../decisions/0025-componentes-con-shadcn-ui.md) hay dos clases de componente, y la diferencia importa al revisar:

- **Los de `components/ui/`** los genera `npx shadcn add` y **no los hemos escrito nosotros**. Están exentos de la convención de comentarios y solo se editan para tokenizar, quitar `dark:` y lo mínimo que exigen nuestros flags de TypeScript. Sus reglas están en [su README](../../apps/web/src/components/ui/README.md).
- **Los de `components/`** son nuestros. Envuelven a los anteriores cuando hace falta comportamiento propio, y son los únicos donde vive una decisión de producto.

**Si la librería lo trae, se usa la librería.** Un chip, un badge, un separador o una caja de aviso no se escriben a mano "porque son cuatro clases": traerlos con `npx shadcn add` cuesta un comando y deja el estado de foco, el `asChild` y las variantes ya resueltos y verificados en un solo sitio. Lo nuestro son las piezas que llevan una decisión de producto dentro.

Lo que shadcn **no** trae, y sigue siendo trabajo nuestro, es justo la pieza central: la caja Player Gap con sus tres layouts no es un componente de librería, es cumplimiento del principio de correlación. Y tener el catálogo delante no es permiso para usarlo: la [§4.6 del brief](brief.md#46-lo-que-no-va-a-existir-en-la-interfaz) sigue prohibiendo _upsell_, _gating_, tablas densas en el componente central y la muestra en un tooltip, aunque ahora exista un `Tooltip` a un comando de distancia.

`Input` y `Skeleton` están traídos y todavía no los usa nadie: son para las páginas de datos que faltan. `Table` y `Breadcrumb` los usan las páginas de spec: la tabla por tramo es una tabla de verdad porque se lee por columnas, y en pantalla estrecha retira columnas en vez de desbordar (§4). `Alert` ya lo usa el aviso de muestra reducida del perfil, y es para los tres estados de confianza y **no** para envolver prosa estática — lleva `role="alert"`, que es una región viva, y "esta lectura todavía no está publicada" no es algo que acabe de ocurrir; esas cajas son `Card` con el borde discontinuo.

`Command` se generó y se borró: es lo que el plan quería para los buscadores y es justo donde no cabe (ver §5.4). Volver a traerlo cuesta un comando.

### 5.1 Los que faltan por construir

Están **especificados aquí y construidos en [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17) y [#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18)**. Cada uno viene de una decisión del brief; la columna "de dónde sale" es lo que impide que se rediseñen por gusto.

| Componente          | Qué es                                                                        | De dónde sale                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `PlayerGapBox`      | La caja, con **tres layouts** según `canShowComparison()`                     | [§1.3](brief.md#13-decisión--la-caja-es-una-lista-no-un-panel-de-barras), [§1.5](brief.md#15-los-tres-estados-de-confianza) |
| `DifferenceRow`     | Una diferencia: nombre, de qué familia es, las dos adopciones con su fracción | [§1.3](brief.md#13-decisión--la-caja-es-una-lista-no-un-panel-de-barras) punto 4                                            |
| `SmallSampleNotice` | El bloque de aviso de `medium`, que ocupa espacio y desplaza                  | [§1.5](brief.md#15-los-tres-estados-de-confianza)                                                                           |
| `NoComparisonBlock` | Lo que **sustituye** al contenido en `insufficient`, con sus dos causas       | [§1.5](brief.md#15-los-tres-estados-de-confianza)                                                                           |
| `CountedFigure`     | Una cifra con su denominador: la fracción manda, el porcentaje acompaña       | [§2.5](brief.md#25-reglas-de-copy-del-bloque-descriptivo)                                                                   |
| `DeclaredAbsence`   | Una línea por ausencia, con su causa y su denominador. Sin fechas             | [§2.3](brief.md#23-los-bloques-en-orden) bloque 4                                                                           |
| `GearRow`           | Item con hueco de icono **reservado**: sin icono, la fila no se recoloca      | [§4.5](brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono)                                                        |
| `AttributionFooter` | La línea de atribución y no afiliación, en el layout, en todas las páginas    | [§4.2](brief.md#42-la-línea-en-las-dos-lenguas), [§4.3](brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua)                  |

### 5.2 Los tres estados no son tres variantes de estilo

Es la regla que más fácil se incumple al maquetar, así que se escribe aparte. `PlayerGapBox` **no** es una caja con una prop `confidence` que cambia un borde: son tres composiciones distintas.

- **`high`** — el contenido completo.
- **`medium`** — el mismo contenido **más** un bloque que ocupa espacio antes de las cifras. Si el aviso se puede pasar por alto haciendo scroll rápido, no cumple "aviso visible" (§13.4 del plan).
- **`insufficient`** — el contenido **se sustituye** por la explicación. Ni lista recortada, ni barras a cero, ni cifras en gris de muestra, ni "coming soon". La caja **mantiene su sitio y su tamaño** encima del pliegue: desaparecer no explica nada.

Quien decide es `canShowComparison()` de `packages/core`, y el `n` que manda es el `gear_sample` del segmento objetivo, no su `sample_size` ([ADR 0010](../decisions/0010-cobertura-por-segmento.md), decisión 3). La UI obedece: aquí no hay ningún umbral.

### 5.3 Lo que ningún componente hace

- **Una barra sin su cifra escrita al lado.** Las barras se pueden usar cuando ayudan a leer una proporción —el peso de cada tramo dentro de una spec, por ejemplo—, siempre con el número en texto junto a ella: la barra ordena la lectura y la cifra es el dato, igual que el color de calidad acompaña al nombre del item. Lo que no se dibuja es una barra cuya forma diga otra cosa que su dato, y ese es el caso de la caja Player Gap: el solapamiento de gear pintado como barra se lee como progreso hacia el rating, y por eso la caja sigue siendo una lista ([§1.4 del brief](brief.md#14-por-qué-no-barras)).
- **Tooltips con la muestra dentro.** El `n` va pegado al porcentaje y siempre visible (§13.5 del plan).
- **Truncar texto.** Ver §4.
- **Comunicar un estado solo con color.** Vale para la confianza, para la calidad de item y para los enlaces, que conservan el subrayado.
- **Quitar el anillo de foco.** Está definido una vez en la base y ningún componente lo pisa.
- **Tablas densas** en el componente central.

### 5.4 El armazón y el buscador

Estos no salen del brief —que decide las tres pantallas del MVP y no el chrome— sino del [ADR 0024](../decisions/0024-busqueda-de-personaje-en-la-web.md) y de la portada. Se apuntan aquí porque ya están construidos y porque tres de ellos llevan una decisión que no se adivina leyendo el código.

| Componente        | Qué es                                                           | Lo que no se adivina                                                                                             |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `SiteSidebar`     | Columna en ancho, franja con menú en estrecho. Un solo marcado   | El panel se escribe una vez y se pinta en dos sitios; nunca están los dos a la vez en el documento               |
| `MobileMenu`      | El menú de pantalla estrecha, sobre `Sheet`                      | **Ya no funciona sin JavaScript.** Era un `checkbox`; se cambió por foco, Escape y bloqueo de desplazamiento     |
| `ClassNav`        | Las clases de la barra lateral, sobre `Collapsible`              | La clase no enlaza porque no tiene página; despliega sus specs, que sí. Los enlaces plegados siguen en el HTML   |
| `CharacterSearch` | La barra segmentada de la portada: región, reino, nombre y botón | Región y reino no son `select`. Ver abajo                                                                        |
| `QuickSearch`     | El buscador de un campo de la barra lateral                      | Solo resuelve lo que ya está en la población; sin sugerencia elegida cae en `/search`                            |
| `SuggestionPanel` | La caja del desplegable y una opción, sobre `Popover`            | La lista y su teclado son nuestros y no de `Command`. Ver abajo                                                  |
| `SuggestionList`  | La lista de sugerencias, compartida por los dos buscadores       | El nombre va en el color de su clase; la spec y el reino están escritos al lado                                  |
| `RecentSearches`  | Las tarjetas de búsquedas recientes                              | Viven en `localStorage` y se anotan solo al elegir una sugerencia, cuando ya se conoce la identidad              |
| `ThemeSwitch`     | El conmutador de tema del pie                                    | Tres opciones y no dos: "lo que diga el sistema" es una elección, y con un interruptor no hay cómo volver a ella |

**El desplegable de los buscadores no es el `Command` de shadcn, y no por gusto.** Su motor hace `preventDefault()` en **todos** los Enter y resalta la primera opción en cuanto la lista aparece. Juntas, esas dos cosas convierten el Enter en "ir al primer homónimo" y dejan el `<form>` sin enviarse — es decir, apagan el fallback a Blizzard del [ADR 0024](../decisions/0024-busqueda-de-personaje-en-la-web.md), que es la única escritura que tiene la web y la razón de ser de la búsqueda. De shadcn se usa `Popover`, que resuelve lo que sí faltaba —colocarse, cerrar con Escape, cerrar al pulsar fuera— y no opina sobre el envío. Que no haya nada resaltado hasta que alguien pulsa una flecha es la diferencia entre haber elegido una sugerencia y no haber elegido ninguna.

**El buscador sigue funcionando sin JavaScript, y el menú ya no.** No es una incoherencia: son dos piezas y solo una escribe. Perder el menú cuesta un rodeo en pantalla estrecha; perder el envío del buscador apaga en silencio la acumulación de población.

**Ningún desplegable del buscador es un `select`.** La región se enseña y no se elige, porque el MVP publica una sola y un desplegable de una opción promete las otras tres (regla 6 del proyecto). El reino se autocompleta pero admite texto libre, porque la lista sale de **nuestra población** y no del catálogo de Blizzard: cerrarla a esos valores dejaría fuera justo al visitante cuyo reino todavía no conocemos, que es de quien hace falta preguntar.

**Las clases de la barra lateral se despliegan, no enlazan.** La clase no tiene página —el mapa de rutas empieza en la spec ([ADR 0020](../decisions/0020-mapa-de-rutas-del-sitio.md))—, así que cada una es un `Collapsible` que abre sus specs, y son las specs las que llevan a `/spec/…`. Se abre sola la clase de la página en la que se está, y su spec se marca con `aria-current`. Los enlaces de las clases plegadas siguen en el HTML (`forceMount`, ocultos con `hidden`): la barra es el único camino interno a la mayoría de specs y un rastreador no despliega nada.

**Una entrada que se nombra y todavía no lleva a ninguna parte no se pinta apagada.** La barra lateral lista las cinco modalidades, y hoy solo una tiene página. La §2.1 no deja un nivel "deshabilitado" con el que insinuarlo, así que **todas se pintan en un nivel de texto real** y la publicada se marca con `aria-current`. La diferencia la lleva el estado de "actual", no un gris.

Conviene saber que esto es **una garantía más débil que la de la [§1.5 del brief](brief.md#15-los-tres-estados-de-confianza)**: allí lo que falta se declara con una frase, y aquí no hay frase. Se aceptó a propósito —una nota bajo cada bloque de la barra lateral era ruido permanente por una carencia temporal—, pero es un desvío consciente y no la regla general. Donde falta **un dato** se sigue escribiendo por qué falta; esto es un mapa de navegación incompleto, que es otra cosa.

---

## 6. Cómo se verifica

Lo que se puede comprobar sin criterio humano, se comprueba solo. [`contrast.test.ts`](../../apps/web/src/design/contrast.test.ts) lee `globals.css` —los bloques `:root, .dark` y `.light`— y falla si:

- un token de texto, de calidad **o de clase** no llega a 4.5:1 contra alguna superficie de su tema — y son las seis que nombra el vocabulario, no las tres distintas que hoy resultan ser;
- un `-foreground` no llega a 4.5:1 sobre su propio relleno. Se verifican por pares: `primary`, `destructive`, `warning`, `card`, `popover`, `secondary` y `accent`, cada uno con el suyo. Antes solo se miraba el botón de acento, que era la única pieza que invertía la paleta;
- el anillo de foco no llega a 3:1 contra alguna superficie;
- `quality-common` o `class-priest` dejan de ser `foreground`;
- el aviso de muestra reducida y `destructive` acaban siendo el mismo color, que es tenerlos separados de nombre y no de hecho;
- `accent` y `card` coinciden, que deja el resaltado de hover invisible;
- aparece un paso tipográfico por debajo de 14px.

La lista de tokens de clase **se deriva de `CLASS_SLUGS`** y no se escribe a mano: una clase nueva en el catálogo del dominio hace fallar el test por token ausente, que es justo lo que tiene que pasar antes de que se pinte sin color.

Corre con `npm test`. Los ratios anotados junto a cada token dicen lo que se midió el día que se eligió el color; el test dice lo que vale hoy.

**Lo que el test no puede ver** y hay que mirar a mano: que los tres estados sean tres layouts y no tres colores, que el aviso de `medium` de verdad desplace al contenido, y que la línea de atribución quepa en tres líneas de móvil en español sin truncar.

Y dos comprobaciones más que tampoco tiene quien las haga sola, porque en `apps/web` no hay tests de renderizado y es deliberado ([README](../../apps/web/README.md)):

- **Que el buscador envíe con el script desactivado.** Es la del [ADR 0024](../decisions/0024-busqueda-de-personaje-en-la-web.md) y sigue siendo parte de dar por bueno un cambio en `CharacterSearch` o en `QuickSearch`.
- **Que no quede ningún `dark:`.** `grep -rn "dark:" apps/web/src` tiene que devolver cero, también dentro de `components/ui/`, y regenerar un componente de shadcn los vuelve a traer.
