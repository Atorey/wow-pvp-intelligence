/**
 * Dónde vive el texto que ve el jugador.
 *
 * Son dos diccionarios tipados y una función, sin librería de i18n. La razón es
 * el tamaño del problema: dos lenguas fijas, sin plurales dependientes de
 * cantidad, sin fechas relativas y con las rutas ya resueltas por el prefijo de
 * locale (ADR 0012, decisión 2). Lo que una librería aporta ahí es un `Provider`
 * de cliente y un formato de fichero que TypeScript no revisa; lo que hace falta
 * —que las dos lenguas tengan exactamente las mismas claves— lo da el tipo.
 *
 * El copy no vive en `packages/core` (ADR 0012, decisión 7): el dominio devuelve
 * códigos y cifras, y la frase la decide la web.
 */
import type { Locale } from "../locales";
import { type Copy, en } from "./en";
import { es } from "./es";

export type { Copy };

const DICTIONARIES: Record<Locale, Copy> = { en, es };

export function copyFor(locale: Locale): Copy {
  return DICTIONARIES[locale];
}
