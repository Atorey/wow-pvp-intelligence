import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Compone clases de Tailwind resolviendo los conflictos por la última que gane.
 *
 * Es la única pieza de `components/ui/` que no viene generada, y existe porque
 * todos los componentes vendidos la importan (ADR 0025). Lo que aporta sobre un
 * `clsx` a secas es `twMerge`: sin él, pasar `className="px-6"` a un componente
 * que ya trae `px-4` deja las dos clases puestas y gana la que Tailwind haya
 * emitido después, que no es la que escribió quien llamó.
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
