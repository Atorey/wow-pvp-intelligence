/**
 * Una proporción dibujada: el ancho de la barra es una cifra que va escrita al
 * lado.
 *
 * Nunca va sola (§5.3 del sistema): la barra ordena la lectura de una columna de
 * cifras y el número es el dato. Por eso para un lector de pantalla no existe
 * —`aria-hidden`—: el texto de al lado dice lo mismo sin ella.
 *
 * El ancho va en `style` y no en una utilidad porque es el dato mismo: Tailwind
 * no genera una clase por cada porcentaje posible, y un literal aquí no es una
 * decisión de diseño que debiera ser un token, es la cifra.
 */
export function ProportionBar({
  value,
  fill,
}: {
  /** En tanto por uno. */
  value: number;
  /** La utilidad de relleno: el color de clase de la spec, de `classColor()`. */
  fill: string;
}) {
  const width = `${Math.min(Math.max(value, 0), 1) * 100}%`;

  return (
    <span
      aria-hidden="true"
      className="bg-muted relative block h-1.5 w-full overflow-hidden rounded-full"
    >
      <span className={`absolute inset-y-0 left-0 rounded-full ${fill}`} style={{ width }} />
    </span>
  );
}
