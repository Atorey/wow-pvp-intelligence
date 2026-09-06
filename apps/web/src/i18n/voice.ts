/**
 * El guardián de voz: cómo se recorre un documento traducido y qué
 * construcciones no puede contener.
 *
 * Vive fuera de los tests porque lo comparten tres —el diccionario de copy, la
 * política de privacidad y la página de metodología— y la lista de patrones no
 * puede existir por triplicado: la copia que nadie actualiza deja de vigilar sin
 * decirlo, y el documento que más habla de cifras sería justo el que se quedara
 * con la lista vieja.
 *
 * Lo que **no** vive aquí son las excepciones. Cada documento decide las suyas y
 * las escribe con su porqué al lado (§3.8 del brief); una lista de exentos
 * compartida sería un comodín, que es lo que esa sección prohíbe.
 */
import type { Locale } from "./locales";

export interface Phrase {
  /** La ruta de la clave, como se escribe al usarla: "home.meta.empty". */
  readonly key: string;
  readonly text: string;
}

/**
 * Todas las frases de un documento, con las plantillas ya resueltas y con su
 * clave al lado.
 *
 * Las claves las garantiza el tipo (el inglés define la forma), así que lo que
 * queda por comprobar son los valores, y para eso hay que ejecutar las
 * funciones: una regla de copy no se cumple en la plantilla, se cumple en la
 * frase montada.
 *
 * La ruta se arrastra por dos motivos: un fallo dice qué clave hay que tocar en
 * vez de obligar a buscar la frase, y las excepciones de voz se pueden escribir
 * por clave en lugar de por texto — una excepción escrita como "esta frase
 * concreta" deja de aplicar en cuanto alguien le cambia una coma, y lo hace en
 * silencio.
 */
export function allPhrases(value: unknown, key = ""): Phrase[] {
  if (typeof value === "string") return [{ key, text: value }];
  if (typeof value === "function") {
    // Argumentos que no aportan palabras propias: lo que se revisa es lo que
    // pone la plantilla alrededor, no lo que se le inyecta.
    return allPhrases((value as (...args: string[]) => string)("A", "B", "C"), key);
  }
  if (Array.isArray(value)) {
    // El índice va en la clave: en un documento de párrafos, "el tercero de
    // este apartado" es lo único que localiza la frase que falla.
    return value.flatMap((item, index) => allPhrases(item, `${key}[${index}]`));
  }
  if (typeof value === "object" && value !== null) {
    return Object.entries(value).flatMap(([name, nested]) =>
      allPhrases(nested, key ? `${key}.${name}` : name),
    );
  }
  return [];
}

/**
 * Construcciones que convierten una correlación en un consejo. Salen de la §3.8
 * del brief, y el español lleva las suyas propias (§3.7) porque la finalidad se
 * cuela con "para" + infinitivo sin que suene a recomendación.
 *
 * Se verifica por lengua y no una vez, porque una traducción fluida puede
 * introducir causalidad donde el original no la tenía (ADR 0012, decisión 9).
 */
export const CAUSAL_PATTERNS: Record<Locale, readonly RegExp[]> = {
  en: [
    /\b(change|try|pick|should|improve|boost)\b/i,
    /\braise your\b/i,
    /\b(best|optimal|definitive) (build|gear|talent)/i,
  ],
  es: [
    /\b(cambia|prueba|deberías|elige|mejora)\b/i,
    // "para" + infinitivo es finalidad, y la finalidad es causalidad.
    /\bpara\s+\w+(ar|er|ir)\b/i,
    /\b(mejor|óptim\w+) (build|gear|talento)/i,
  ],
};
