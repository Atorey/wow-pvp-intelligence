/**
 * Conversión de las columnas que node-postgres no devuelve como número.
 *
 * `numeric` y `bigint` llegan como string, y lo hace a propósito: son tipos con
 * más precisión de la que cabe en un `double`, así que el driver prefiere no
 * decidir por nosotros. En estas tablas las medianas y los `adoption_rate` caben
 * de sobra, y el `item_id` también, así que se convierten aquí —en el borde, una
 * sola vez— en lugar de dejar que un string se cuele hasta una plantilla y se
 * pinte "0.74000000000000000000".
 *
 * Merece función propia y no un `Number(...)` suelto porque `Number("")` es 0 y
 * `Number(null)` también: un dato ausente se convertiría en un cero perfectamente
 * creíble, que es la confusión que prohíbe la regla 5 del proyecto.
 */
export function toNumber(value: string | number): number {
  // La cadena vacía se descarta antes de convertir porque `Number("")` es 0, y
  // un 0 fabricado es indistinguible de un 0 medido en cuanto sale de aquí.
  const parsed = typeof value === "number" ? value : value.trim() === "" ? NaN : Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Se esperaba un número y llegó ${JSON.stringify(value)}.`);
  }
  return parsed;
}

/** Igual, pero para columnas que admiten null. `null` sigue siendo "no disponible". */
export function toNumberOrNull(value: string | number | null): number | null {
  return value === null ? null : toNumber(value);
}
