/**
 * El registro de servidor de la web (ADR 0031).
 *
 * Una línea JSON por suceso, a stderr. Netlify las recoge en los registros de
 * función, y eso es todo el destino que tienen: **ningún tercero**. No es una
 * limitación técnica, es la decisión 1 del ADR 0028 — el día que un servicio
 * alojado fuera reciba algo de aquí hará falta un ADR que la revise, no un
 * `npm install`.
 *
 * JSON y no texto libre porque estas líneas se leen buscando, no leyendo: "¿ha
 * vuelto a pasar?" es un filtro por `event`, y con frases en prosa es un grep
 * que envejece. El pipeline sigue imprimiendo prosa y está bien: allí lo lee una
 * persona que acaba de lanzar el job.
 *
 * **Lo que nunca entra aquí**: ni IP, ni user-agent, ni el nombre del personaje
 * que se estaba mirando. La política de privacidad promete que de quien visita
 * no se guarda nada (ADR 0028, decisión 5), y unos registros con la ruta
 * resuelta dentro serían exactamente el registro de visitas que dice que no
 * existe. Se registra la **forma** de la ruta, no la ruta.
 */

/** Los sucesos que esta web sabe contar. Cerrado a propósito: un catálogo, no texto libre. */
export type ServerEvent =
  /** El render de una página falló. Lo levanta `onRequestError`. */
  | "render-error"
  /** No se pudo escribir un evento de la North Star: una fila de métrica perdida. */
  | "gap-view-write-failed"
  /** No se pudo preguntar a Blizzard: sin cuota o sin presupuesto de tiempo. */
  | "blizzard-unavailable";

/**
 * Campos admitidos. Primitivos y nada más: un objeto anidado invita a meter
 * dentro la respuesta entera de algo, y con ella lo que no debe salir.
 */
export type LogFields = Record<string, string | number | boolean | null>;

export function logServerEvent(event: ServerEvent, fields: LogFields = {}): void {
  // A stderr y no a stdout: en Netlify los dos acaban en el mismo sitio, pero
  // un `next build` que imprimiera esto por stdout lo mezclaría con su salida.
  console.error(
    JSON.stringify({
      at: new Date().toISOString(),
      event,
      ...fields,
    }),
  );
}
