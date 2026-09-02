import { type ClassSlug, isClassSlug } from "@wowpvp/core";

/**
 * El color de clase, como utilidades de Tailwind.
 *
 * Los valores viven en `globals.css` (`--color-class-*`, con su verificación de
 * contraste en `contrast.test.ts`); aquí solo está la correspondencia con las
 * clases de utilidad. Están escritas **enteras y a mano** porque Tailwind lee el
 * código fuente como texto: `text-class-${slug}` no aparecería en ningún fichero
 * y la utilidad no se generaría, así que el nombre se pintaría sin color y sin
 * error en ninguna parte.
 *
 * El `Record<ClassSlug, …>` es lo que impide que la tabla se quede corta: una
 * clase nueva en el catálogo rompe el `typecheck` aquí.
 */
interface ClassColor {
  /** El nombre del personaje o de la spec. */
  readonly text: string;
  /** El filete de una tarjeta o el borde del hueco del icono. */
  readonly border: string;
  /** El relleno de una barra de proporción. */
  readonly fill: string;
}

const CLASS_COLORS: Record<ClassSlug, ClassColor> = {
  "death-knight": {
    text: "text-class-death-knight",
    border: "border-class-death-knight",
    fill: "bg-class-death-knight",
  },
  "demon-hunter": {
    text: "text-class-demon-hunter",
    border: "border-class-demon-hunter",
    fill: "bg-class-demon-hunter",
  },
  druid: { text: "text-class-druid", border: "border-class-druid", fill: "bg-class-druid" },
  evoker: { text: "text-class-evoker", border: "border-class-evoker", fill: "bg-class-evoker" },
  hunter: { text: "text-class-hunter", border: "border-class-hunter", fill: "bg-class-hunter" },
  mage: { text: "text-class-mage", border: "border-class-mage", fill: "bg-class-mage" },
  monk: { text: "text-class-monk", border: "border-class-monk", fill: "bg-class-monk" },
  paladin: { text: "text-class-paladin", border: "border-class-paladin", fill: "bg-class-paladin" },
  priest: { text: "text-class-priest", border: "border-class-priest", fill: "bg-class-priest" },
  rogue: { text: "text-class-rogue", border: "border-class-rogue", fill: "bg-class-rogue" },
  shaman: { text: "text-class-shaman", border: "border-class-shaman", fill: "bg-class-shaman" },
  warlock: { text: "text-class-warlock", border: "border-class-warlock", fill: "bg-class-warlock" },
  warrior: { text: "text-class-warrior", border: "border-class-warrior", fill: "bg-class-warrior" },
};

/**
 * Lo que se pinta cuando no se sabe la clase.
 *
 * `null` en `class_slug` significa "no disponible" (regla 5 del proyecto), y un
 * personaje sin clase observada se pinta con el color de texto del tema: ni se
 * le adivina una clase ni se le apaga el nombre para señalar que falta un dato
 * que no es suyo.
 */
const UNKNOWN: ClassColor = {
  text: "text-foreground",
  border: "border-input",
  fill: "bg-subtle-foreground",
};

export function classColor(classSlug: string | null | undefined): ClassColor {
  if (!classSlug || !isClassSlug(classSlug)) return UNKNOWN;
  return CLASS_COLORS[classSlug];
}
