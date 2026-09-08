/**
 * Cuánto vale una cifra agregada antes de que exista otra.
 *
 * Los agregados se materializan a diario (ADR 0007) y cada fila guarda el
 * `computed_at` de la corrida que la produjo. Eso es lo que da la vigencia de
 * cualquier caché sobre esas cifras: **una respuesta calculada con la corrida de
 * hoy sirve exactamente hasta que puede existir la de mañana**. Una TTL elegida
 * a ojo diría lo mismo por casualidad y dejaría de decirlo el día que cambie la
 * cadencia.
 *
 * Vive aquí, y no en la web ni en el pipeline, por lo mismo que
 * `canShowComparison()` y `isActiveWithin()`: si "está viejo" se escribiera dos
 * veces, la web y el vigilante serían dos reglas distintas que coinciden de
 * milagro. La web lo usa para decirlo en la página; el pipeline, para fallar.
 *
 * Ninguna de estas funciones mira el reloj por su cuenta: `now` entra como
 * parámetro, que es lo que las hace comprobables sin esperar un día.
 */

const MS_PER_HOUR = 60 * 60 * 1000;

/** Cada cuánto se recalculan los agregados (ADR 0007: la corrida es diaria). */
export const AGGREGATE_RUN_INTERVAL_HOURS = 24;

/**
 * A partir de cuándo la corrida vigente deja de ser "la de hoy".
 *
 * Son 36 horas y no 24 a propósito: el cron de Actions no es puntual y el propio
 * workflow de agregados lo da por hecho. Con 24 saltaría la alarma cada vez que
 * la corrida se retrasa media hora, y una alarma que salta sin motivo se ignora
 * a las tres semanas. Con 36 solo salta cuando **se ha perdido una corrida
 * entera**, que es el suceso del que alguien tiene que enterarse.
 */
export const AGGREGATE_STALE_AFTER_HOURS = 36;

/**
 * Cuándo deja de ser la última palabra la corrida que produjo esta cifra.
 *
 * No es "cuándo caduca el dato" —el de ayer sigue siendo cierto sobre ayer—,
 * sino cuándo puede haber uno más reciente que valga la pena ir a buscar.
 */
export function aggregateExpiresAt(computedAt: Date): Date {
  return new Date(computedAt.getTime() + AGGREGATE_RUN_INTERVAL_HOURS * MS_PER_HOUR);
}

/**
 * Si el dato vigente ya no es el que debería haber.
 *
 * Que dé `true` no significa que la cifra esté mal: significa que la corrida que
 * tenía que haberla sustituido no llegó, y eso es algo que se dice —en la página
 * y en la bandeja de quien opera— en vez de servirlo como si fuera de hoy.
 *
 * Una fecha en el futuro no se considera vieja: es un desfase de relojes entre
 * el runner y la base, no una corrida perdida.
 */
export function isAggregateStale(computedAt: Date, now: Date): boolean {
  return now.getTime() - computedAt.getTime() > AGGREGATE_STALE_AFTER_HOURS * MS_PER_HOUR;
}

/** Horas transcurridas desde la corrida, para poder decirlas. Nunca negativo. */
export function aggregateAgeHours(computedAt: Date, now: Date): number {
  return Math.max(0, (now.getTime() - computedAt.getTime()) / MS_PER_HOUR);
}

/**
 * Suelo de vigencia de una caché de agregados.
 *
 * Existe por un caso que solo aparece midiendo: cuando una corrida se retrasa,
 * su `aggregateExpiresAt()` **ya está en el pasado**, así que una caché que solo
 * mirase esa fecha fallaría en todas y cada una de las visitas. Es decir, dejaría
 * de proteger la base exactamente el día que el recálculo está caído — que es
 * cuando hay que protegerla, porque la respuesta no va a cambiar por mucho que
 * se pregunte: hasta que no corra el job no hay dato nuevo que traer.
 */
export const MIN_AGGREGATE_CACHE_MINUTES = 5;

/**
 * Hasta cuándo puede recordarse una respuesta calculada con esta corrida.
 *
 * Con la corrida al día es su caducidad natural —vale hasta que pueda existir la
 * siguiente—; con la corrida retrasada, el suelo. Nunca es cero, y nunca guarda
 * un dato más allá de la corrida que tendría que sustituirlo.
 */
export function aggregateCacheUntil(computedAt: Date, now: Date): Date {
  const expires = aggregateExpiresAt(computedAt);
  const floor = new Date(now.getTime() + MIN_AGGREGATE_CACHE_MINUTES * 60 * 1000);
  return expires.getTime() > floor.getTime() ? expires : floor;
}
