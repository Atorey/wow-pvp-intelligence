import type { RatingPoint } from "@wowpvp/core";

import { markedPoints, ratingChartGeometry } from "../design/rating-chart";
import { formatDate, formatDayMonth, formatRating } from "../i18n/format";
import type { Locale } from "../i18n/locales";

/**
 * La evolución del rating: una serie, en el color de la clase.
 *
 * Se pinta en el servidor y sin JavaScript, como el resto del perfil. La línea y
 * la rejilla son un SVG que se estira al ancho de la columna
 * (`preserveAspectRatio="none"`, con trazo que no escala); los puntos y las
 * etiquetas son HTML colocado en los mismos porcentajes, para que no encojan con
 * el dibujo en un móvil. La geometría es `ratingChartGeometry()`, con sus tests.
 *
 * **No es la única forma de leer el dato**: todo el gráfico es `aria-hidden` y
 * su gemelo es la tabla de observaciones que lo acompaña. El `title` de cada
 * punto es la ayuda de quien pasa el ratón, no el acceso a la cifra.
 *
 * Una sola serie no lleva leyenda: el título del bloque dice qué se pinta. Y el
 * color es el de la clase, que ya tiene su contraste medido contra el fondo en
 * los dos temas (`contrast.test.ts`) como texto, un listón más alto que el de
 * una línea.
 */
export function RatingChart({
  locale,
  points,
  color,
}: {
  locale: Locale;
  /** Al menos dos, en orden de fecha. */
  points: readonly RatingPoint[];
  /** La utilidad de texto de la clase, de `classColor()`: la línea usa `currentColor`. */
  color: string;
}) {
  const geometry = ratingChartGeometry(points);
  const line = geometry.points.map((point) => `${point.x},${point.y}`).join(" ");

  return (
    <div
      aria-hidden="true"
      className="text-subtle-foreground grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 text-sm tabular-nums"
    >
      <div className="relative h-56 min-w-10">
        {geometry.yTicks.map((tick) => (
          <span
            key={tick.value}
            className="absolute right-0 -translate-y-1/2 leading-none"
            style={{ top: `${tick.y}%` }}
          >
            {formatRating(tick.value, locale)}
          </span>
        ))}
      </div>

      {/* El margen lateral es para que el primer y el último punto no se corten por la mitad. */}
      <div className={`relative mx-2 h-56 ${color}`}>
        <svg
          className="absolute inset-0 size-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {geometry.yTicks.map((tick) => (
            <line
              key={tick.value}
              x1={0}
              x2={100}
              y1={tick.y}
              y2={tick.y}
              className="stroke-border"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <polyline
            points={line}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
        {markedPoints(geometry).map((point) => (
          // La zona que atiende al ratón mide 24px y el punto 8: nadie acierta a
          // un punto de 8 px, y el `title` solo aparece si se acierta.
          <span
            key={point.at.getTime()}
            title={`${formatDate(point.at, locale)} · ${formatRating(point.rating, locale)}`}
            className="absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <span className="ring-card size-2 rounded-full bg-current ring-2" />
          </span>
        ))}
      </div>

      <div />
      <div className="relative mx-2 mt-2 h-5">
        {geometry.xTicks.map((tick, index) => (
          <span
            key={tick.at.getTime()}
            // La primera se alinea a la izquierda y la última a la derecha: centradas
            // se saldrían del gráfico por los dos extremos.
            className={`absolute whitespace-nowrap ${
              index === 0
                ? ""
                : index === geometry.xTicks.length - 1
                  ? "-translate-x-full"
                  : "-translate-x-1/2"
            }`}
            style={{ left: `${tick.x}%` }}
          >
            {formatDayMonth(tick.at, locale)}
          </span>
        ))}
      </div>
    </div>
  );
}
