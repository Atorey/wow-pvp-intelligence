/**
 * Los plazos de la revalidación de 30 días (ADR 0015, decisión 2; ADR 0043).
 *
 * Van juntos porque solo tienen sentido como cadena: desde la última prueba de
 * que un personaje existe hasta que lo suyo ha salido también de Storage no
 * pueden pasar más de `DATA_TTL_DAYS`. Con estos valores, el peor caso es:
 *
 *   día 18  el barrido lo comprueba y Blizzard da 404: queda anotado
 *   día 19  la corrida siguiente lo confirma y lo borra de Postgres
 *   día 22  la purga lo saca de los lotes y del índice de Storage
 *
 * Quedan ocho días de margen para una corrida perdida, que es lo que hace que
 * `check-freshness` avise antes de que el plazo se incumpla y no después.
 */

/** Lo que la ToU permite guardar un dato sin revalidarlo. No es configurable. */
export const DATA_TTL_DAYS = 30;

/** A partir de cuántos días sin prueba de existencia el barrido pregunta a Blizzard. */
export const REVALIDATE_AFTER_DAYS = 18;

/**
 * Horas entre el primer 404 y el que lo confirma. Menos de 24 a propósito: el
 * cron de Actions no es puntual, y con 24 exactas una corrida que llegara unos
 * minutos antes que la del día anterior dejaría la confirmación para otro día.
 */
export const MISSING_CONFIRM_HOURS = 20;

/**
 * La purga de Storage espera a que algún borrado pendiente tenga su última
 * prueba así de lejos. No es pereza: la purga baja el archivo entero para
 * encontrar a quién quitar, y hacerlo una vez cada pocos días con todos los
 * pendientes juntos cuesta lo mismo que hacerlo cada día con uno.
 */
export const PURGE_AT_DAYS = 22;

export const MS_PER_DAY = 86_400_000;
export const MS_PER_HOUR = 3_600_000;
