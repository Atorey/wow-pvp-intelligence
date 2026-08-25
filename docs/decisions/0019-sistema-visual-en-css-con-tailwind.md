# ADR 0019 — El sistema visual son tokens en CSS con Tailwind, sin librería de componentes

**Fecha**: 25 de agosto de 2026 · **Estado**: aceptada (issue [#65](https://github.com/Atorey/wow-pvp-intelligence/issues/65)) · **Amplía el [ADR 0001](0001-estructura-del-repo-y-stack.md)**, que eligió Next.js sin decir nada de estilos. **Desbloquea [#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17), [#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18) y [#20](https://github.com/Atorey/wow-pvp-intelligence/issues/20)**. Lo que se ve —paleta, escala, componentes— está en [docs/design/system.md](../design/system.md)

## Contexto

`docs/design/brief.md` decidió qué dice cada hueco de las tres pantallas del MVP y fue dejando por el camino una lista de componentes concretos que alguien tiene que construir: la fila de diferencia y el bloque de aviso de la [§1.9](../design/brief.md#19-consecuencias), la fila de cifra con denominador y el bloque de ausencia declarada de la [§2.7](../design/brief.md#27-consecuencias), la fila de gear con el hueco de icono reservado de la [§4.5](../design/brief.md#45-los-iconos-de-item-qué-se-ve-cuando-no-hay-icono) y la línea de atribución del layout de la [§4.7](../design/brief.md#47-consecuencias). Lo que no existía es **dónde viven los valores** con los que se maquetan, ni con qué herramienta.

El [ADR 0001](0001-estructura-del-repo-y-stack.md) eligió Next.js y no dijo nada de estilos, así que hasta hoy el andamiaje de [#62](https://github.com/Atorey/wow-pvp-intelligence/issues/62) tenía tres variables CSS con un comentario que las declaraba provisionales. Empezar #17 sin cerrar esto significa que la primera pantalla inventa su paleta y las siguientes la copian mal.

Hay tres restricciones que llegan de fuera y acotan la decisión antes de empezar:

- **La confianza no se comunica solo por color** ([§1.7 del brief](../design/brief.md#17-reglas-que-la-caja-hereda-y-no-puede-relajar)). Los tres estados de `canShowComparison()` son tres layouts distintos ([ADR 0003](0003-umbrales-de-confianza.md)), no el mismo con tres bordes de color. Eso saca del sistema justo la pieza que una librería de componentes suele aportar.
- **La línea de atribución es texto de cuerpo con un contraste mínimo exigible** ([§4.3 del brief](../design/brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua)), porque la cláusula 2.m de la ToU pide _"clearly and conspicuously"_ ([ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md)). El contraste deja de ser buena práctica y pasa a ser requisito contractual.
- **El móvil es el caso de diseño, no la adaptación** (§23 del plan): Player Gap cabe en una pantalla estrecha sin scroll horizontal, y el español ocupa más que el inglés ([§3.2 del brief](../design/brief.md#32-el-idioma-del-copy)).

Y una restricción de estética, decidida en esta issue: el producto se parece a **la categoría**, no a Blizzard. Oscuro, acentos dorados, tipografía con carácter — pero ni las tipografías de Blizzard, ni sus texturas, ni sus marcos ornamentales. La decisión 8 del [ADR 0015](0015-uso-de-la-api-de-blizzard-y-de-su-propiedad-intelectual.md) prohíbe el uso decorativo de su marca, y replicar su _trade dress_ es exactamente la apariencia de respaldo que la 2.m no permite.

## Decisión

1. **Los estilos se escriben con Tailwind v4, y el tema vive en el bloque `@theme` de [`globals.css`](../../apps/web/src/app/globals.css).** Tailwind v4 no tiene fichero de configuración: la configuración es CSS. No hay `tailwind.config.ts` y no se añade uno.

2. **Los tokens semánticos son la API, y no hay valores arbitrarios.** Se escribe `text-ink-secondary`, no `text-[#a8aab4]`; `px-5`, no `px-[19px]`. Un color o un tamaño escrito a mano en un componente queda fuera del sistema y fuera de la verificación de contraste, que es el único sitio donde se comprueba que cumple.

3. **Los tokens son semánticos, no descriptivos.** `--color-ink-muted`, no `--color-gray-400`; `--color-quality-epic`, no `--color-purple`. Un token con nombre de color no se puede reasignar al cambiar de tema sin quedar mintiendo.

4. **El tema se cambia reasignando variables, nunca con la variante `dark:`.** El oscuro va en `@theme` y es el de por defecto —también cuando el sistema no expresa preferencia—; el claro reasigna en `@media (prefers-color-scheme: light)` los tokens que cambian de valor. **Un `dark:` en un componente de este repo es un error**, no un estilo alternativo.

5. **No hay librería de componentes de terceros.** Ni MUI, ni Chakra, ni un conjunto pegado de Radix. Los componentes del [sistema](../design/system.md) son propios.

6. **No hay CSS-in-JS ni módulos CSS.** Fuera de `globals.css` no crece una segunda hoja de estilos: lo que no sea una utilidad en el punto de uso, es un token.

7. **El contraste se verifica con un test, no con una revisión.** [`contrast.test.ts`](../../apps/web/src/design/contrast.test.ts) lee `globals.css` y comprueba cada token de texto y de calidad contra **las tres superficies** de su tema. Corre con `npm test`.

8. **Las tipografías se auto-alojan.** `next/font` descarga el fichero en build y lo sirve desde nuestro dominio. El navegador del jugador no pide nada a Google.

## Por qué

**Porque el tema tiene que poder cambiar sin tocar un solo componente.** Es la razón de la decisión 4 y la que descarta la alternativa obvia. Un componente escrito como `bg-surface dark:bg-slate-900` toma la decisión de color **dos veces**, en el marcado, y a partir del tercer componente los dos temas divergen sin que nadie lo note: alguien ajusta el claro y se olvida del oscuro. Reasignando la variable, cualquier componente ya escrito funciona en los dos temas sin haberse enterado de que existen. Y tiene una consecuencia medible que la variante `dark:` no puede dar: el test de la decisión 7 verifica los dos temas leyendo **un solo fichero**, porque los dos temas son ese fichero. Con `dark:` habría que verificar cada componente.

**Porque el contraste anotado envejece y el medido no.** Cada token lleva su ratio en un comentario, y ese comentario dice lo que se midió el día que se eligió el color. Basta con que alguien aclare un fondo dos puntos para que la anotación pase a ser falsa y siga ahí, tranquilizando a quien la lee. El test no tranquiliza: falla. Esto no es celo de accesibilidad genérica — la [§4.3 del brief](../design/brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua) convierte el contraste de un texto concreto en el cumplimiento de una cláusula, y un cumplimiento que depende de que nadie se despiste no es un cumplimiento.

**Porque verificar contra la superficie "buena" fabrica una regla que nadie recuerda.** Los colores de calidad canónicos del juego —el azul `#0070dd` y el morado `#a335ee`— pasan AA sobre `--color-surface` y **fallan** sobre `--color-raised`. Elegirlos mirando solo la superficie que se tenía en mente deja el sistema con una nota al pie: "el morado, solo sobre esta superficie". Al tercer componente esa nota no la recuerda nadie. Por eso cada token se resuelve contra **el fondo peor de su tema** —el más claro en oscuro, el más oscuro en claro— y las variantes que se usan no son las canónicas, sino las más cercanas que pasan en cualquier sitio.

**Porque una librería de componentes no trae lo que hace falta y sí trae lo que estorba.** Lo que aportan MUI o Radix es el catálogo de piezas de aplicación —modales, menús, tablas de datos, formularios, _tooltips_— y este producto tiene la mitad de ese catálogo prohibida por escrito: nada de _upsell_ ni _gating_ ([§4.6 del brief](../design/brief.md#46-lo-que-no-va-a-existir-en-la-interfaz)), nada de tablas densas en el componente central (§23 del plan), y la muestra **nunca** en un tooltip (§13.5). Lo que sí hace falta —la caja con tres layouts según `canShowComparison()`, la fila de diferencia con las dos adopciones y su fracción cruda— no lo tiene ninguna librería, porque es cumplimiento del principio de correlación y no maquetación. Quedaría el coste: encajar una paleta verificada sobre los tokens de un tercero, y arrastrar sus dependencias en un producto que se sirve _serverless_ con presupuesto de cuota ([ADR 0013](0013-web-serverless-y-cuota-en-postgres.md)).

**Porque el reproche habitual a Tailwind no aplica bien aquí.** Meter las decisiones de estilo en el marcado se paga cuando hay muchas pantallas y muchas manos; el MVP tiene tres pantallas y una decena de componentes propios, todos descritos ya en el brief. A cambio, la alternativa —CSS a mano o módulos— reintroduce justo lo que la decisión 2 quiere evitar: un sitio fuera del sistema donde escribir un `#hex` sin que nada se queje.

**Porque una fuente que se pide a un tercero es una fuente que puede no llegar, y un dato que se le regala.** El auto-alojado de la decisión 8 sale gratis con `next/font` y evita las dos cosas: que la tipografía dependa de un dominio ajeno en tiempo de ejecución, y que cada visita informe a Google de que ha ocurrido. Lo segundo tiene además consecuencias para [#69](https://github.com/Atorey/wow-pvp-intelligence/issues/69), que es quien tiene que declarar a quién se le cuenta una visita.

## Consecuencias

- **[#17](https://github.com/Atorey/wow-pvp-intelligence/issues/17), [#18](https://github.com/Atorey/wow-pvp-intelligence/issues/18) y [#20](https://github.com/Atorey/wow-pvp-intelligence/issues/20) quedan desbloqueadas** con paleta, escala, espaciado y una lista de componentes especificados en [docs/design/system.md](../design/system.md). Ninguna de las tres tiene que inventar un valor.
- **El [ADR 0001](0001-estructura-del-repo-y-stack.md) se amplía, no se corrige.** Eligió el stack y no llegó a la capa de estilos; esto la añade. `apps/web` gana dos dependencias de desarrollo (`tailwindcss`, `@tailwindcss/postcss`) y un `postcss.config.mjs` de cinco líneas.
- **Aparece una regla que un revisor comprueba de un vistazo**: un `dark:`, un `#hex` o un `[13px]` en un componente es un defecto. No hace falta juzgar si el color es bonito.
- **Los colores de calidad que se pintan no son los del juego**, y conviene saberlo antes de que alguien "corrija" el morado comparándolo con una captura del cliente. Son los más cercanos que cumplen AA sobre cualquier superficie del tema, y el desvío está anotado en `globals.css` con su ratio.
- **`--color-quality-common` no es blanco**: es el color de texto del tema, porque "común" es la ausencia de tinte y no un gris elegido. En el tema claro, el blanco canónico del juego sería invisible.
- **La escala tipográfica no tiene ningún paso por debajo de 14px**, lo que hace la "letra pequeña" de la [§4.3](../design/brief.md#43-dónde-va-y-qué-hace-que-sea-conspicua) imposible de escribir por descuido: no existe el token con el que hacerlo. Redefine los pasos `text-xs` y `text-sm` de Tailwind en vez de añadir nombres nuevos, para que el `text-xs` de la documentación de Tailwind no signifique aquí otra cosa.
- **Queda trabajo que este ADR no hace**: los componentes están **especificados y no construidos**. Los construyen #17 y #18. La línea de atribución que la [§4.7 del brief](../design/brief.md#47-consecuencias) asigna al layout es la primera de esa lista, y hoy el layout no la renderiza.
- **El copy de los componentes sigue siendo de [#25](https://github.com/Atorey/wow-pvp-intelligence/issues/25).** El sistema fija que se maqueta para el texto más largo de los dos idiomas; qué dice ese texto, no.
