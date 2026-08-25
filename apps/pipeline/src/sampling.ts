/**
 * Muestreo aleatorio reproducible.
 *
 * Aleatorio y no "los N primeros del ranking" porque el tope de la muestra no
 * debe sesgar el resultado: el gear del percentil alto de 1800-2000 no
 * representa al bucket, y ese sesgo se propagaría a cualquier adoption_rate
 * calculado después sobre esta muestra.
 *
 * Reproducible porque un hallazgo de Phase 0 tiene que poder auditarse: con la
 * misma semilla y la misma población, la muestra es la misma. Por eso no se usa
 * Math.random() ni `order by random()` en SQL.
 */

/** Hash de string a entero de 32 bits (FNV-1a). Convierte la semilla en estado inicial. */
function hashSeed(seed: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    hash ^= seed.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** PRNG mulberry32: pequeño, determinista y suficiente para elegir a quién muestreamos. */
function mulberry32(state: number): () => number {
  let a = state;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Generador determinista a partir de una semilla de texto.
 *
 * Se expone porque el muestreo no es lo único que necesita azar reproducible:
 * el dataset de desarrollo (`seed`) reparte items, ratings y fechas con el
 * mismo criterio —misma semilla, mismo resultado— y una segunda copia del PRNG
 * daría dos definiciones de "reproducible" que nadie notaría hasta que
 * divergieran.
 */
export function seededRandom(seed: string): () => number {
  return mulberry32(hashSeed(seed));
}

/**
 * Muestra de como mucho `limit` elementos, elegida de forma aleatoria pero
 * determinista a partir de `seed`.
 *
 * `limit <= 0` significa censo: se devuelve la población entera. Es el mismo
 * camino de código que la muestra, solo que sin tope — así pasar de muestrear a
 * censar es un parámetro, no una rama distinta que pueda divergir.
 *
 * No muta la lista de entrada.
 */
export function takeSample<T>(items: readonly T[], limit: number, seed: string): T[] {
  const shuffled = [...items];
  const random = seededRandom(seed);

  // Fisher-Yates. Se baraja siempre, también en el censo: así el orden de
  // descarga no sigue al de character_id y una ejecución cortada a la mitad
  // deja una muestra parcial repartida por el bucket, no su primer trozo.
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j] as T, shuffled[i] as T];
  }

  return limit > 0 ? shuffled.slice(0, limit) : shuffled;
}
