import { gunzipSync, gzipSync } from "node:zlib";

/**
 * El formato de los lotes del archivo (ADR 0034). El cliente de Storage vive en
 * `@wowpvp/storage`, porque desde el ADR 0039 también lo usa la web; esto se
 * queda aquí porque solo el pipeline escribe y lee lotes.
 */

/**
 * Filas como NDJSON comprimido: una línea JSON por fila, tal y como las devuelve
 * `pg`.
 *
 * NDJSON y no CSV porque la tabla tiene arrays (`gem_item_ids`,
 * `enchantment_ids`) y nulos que significan "no disponible" (regla 5): en CSV
 * los dos se aplanan a texto y leerlos de vuelta obliga a reinventar su escape.
 * Los `bigint` llegan de `pg` como texto y así se quedan, sin perder precisión.
 */
export function encodeRows(rows: readonly object[]): Buffer {
  const body = rows.map((row) => JSON.stringify(row)).join("\n");
  return gzipSync(rows.length === 0 ? "" : `${body}\n`);
}

/**
 * La lectura inversa. Las fechas vuelven como texto ISO, que es como las
 * escribió `JSON.stringify`: convertirlas es cosa de quien sabe qué columna es
 * una fecha.
 */
export function decodeRows<T>(body: Buffer): T[] {
  return gunzipSync(body)
    .toString("utf8")
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as T);
}
