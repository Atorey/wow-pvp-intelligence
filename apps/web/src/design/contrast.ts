/**
 * Contraste WCAG sobre los tokens de `globals.css`.
 *
 * Vive en el repo y no en una hoja de cálculo porque los ratios anotados junto
 * a cada token envejecen en cuanto alguien ajusta un color: la anotación dice
 * lo que se midió, el test dice lo que vale hoy. La issue #65 lleva etiqueta
 * `accessibility` y ésta es la parte de esa etiqueta que una revisión humana no
 * puede hacer de memoria.
 */

/** Canal sRGB linearizado (WCAG 2.x, definición de luminancia relativa). */
function linearize(channel: number): number {
  const c = channel / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const value = Number.parseInt(hex.slice(1), 16);
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`Color no reconocido: ${hex}. Los tokens se escriben en #rrggbb.`);
  }
  return (
    0.2126 * linearize((value >> 16) & 0xff) +
    0.7152 * linearize((value >> 8) & 0xff) +
    0.0722 * linearize(value & 0xff)
  );
}

export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const [lighter, darker] = a >= b ? [a, b] : [b, a];
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Extrae las declaraciones `--token: valor;` de un fragmento de CSS. No es un
 * parser de CSS: es deliberadamente tonto porque el fichero que lee es nuestro
 * y tiene una forma conocida. Si deja de tenerla, los tests de abajo fallan por
 * token ausente en vez de pasar por vacío.
 */
export function parseCustomProperties(css: string): Map<string, string> {
  const declarations = new Map<string, string>();
  for (const match of css.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    const name = match[1];
    const value = match[2];
    if (name === undefined || value === undefined) continue;
    declarations.set(name, value.trim());
  }
  return declarations;
}

/**
 * Un bloque de primer nivel de `globals.css`, localizado por su selector.
 *
 * Cierra en el primer `}` a principio de línea, que es donde acaban todos los
 * bloques de ese fichero. Vale porque el fichero es nuestro y tiene una forma
 * conocida; si deja de tenerla, esto lanza en vez de devolver un mapa vacío.
 */
function block(css: string, selector: RegExp, what: string): string {
  const found = new RegExp(`${selector.source}\\s*\\{([\\s\\S]*?)\\n\\}`).exec(css);
  if (found?.[1] === undefined) throw new Error(`No se encontró ${what} en globals.css`);
  return found[1];
}

/**
 * El bloque `:root, .dark`, que es el tema oscuro y la base de todo.
 *
 * Los dos selectores van juntos porque son el mismo tema: `.dark` es lo que
 * pone el conmutador, y `:root` a secas es lo que se pinta antes de que exista
 * la clase —la primera pintura, o el visitante sin JavaScript— (ADR 0025).
 */
export function darkTheme(css: string): Map<string, string> {
  return parseCustomProperties(block(css, /:root,\s*\.dark/, "el bloque del tema oscuro"));
}

/** El oscuro con las reasignaciones de `.light`, que solo trae lo que cambia. */
export function lightTheme(css: string): Map<string, string> {
  const light = parseCustomProperties(block(css, /\.light/, "el bloque del tema claro"));
  return new Map([...darkTheme(css), ...light]);
}

/**
 * El `@theme` sin `inline`: la tipografía, la escala y las medidas, que no
 * dependen del tema. El `@theme inline` de los colores no cae aquí porque
 * lleva la palabra en medio, y lo que tiene dentro son `var(…)` y no valores.
 */
export function scale(css: string): Map<string, string> {
  return parseCustomProperties(block(css, /@theme/, "el bloque @theme de la escala"));
}
