"use client";

import { useEffect, useRef } from "react";

import type { GapViewEventData } from "../analytics/gap-view";
import { visitorId } from "../analytics/visitor";

/**
 * El evento de la North Star, emitido por la propia caja Player Gap (§35).
 *
 * No pinta nada y aun así es un componente de cliente, por una razón que no
 * tiene vuelta: la caja se renderiza en el servidor y el identificador del
 * visitante vive en su navegador. La alternativa —contar en el servidor— mide
 * renders, no personas, y la métrica dice "por usuario único".
 *
 * Va **dentro** de la caja y no en la página que la contiene: lo que se mide es
 * que la caja se enseñó y con qué desenlace, así que si algún día deja de
 * renderizarse en algún camino, el evento tiene que desaparecer con ella y no
 * quedarse contando vistas que no ocurrieron.
 */
export function GapViewEvent({ event }: { event: GapViewEventData }) {
  /*
   * Una vista, un evento. El efecto se ejecuta dos veces en desarrollo por el
   * modo estricto de React, y la caja se vuelve a montar al navegar entre
   * pestañas del perfil sin recargar; las dos cosas duplicarían la fila. La
   * guarda es por contenido y no un booleano: cambiar de spec dentro del mismo
   * perfil sí es otra vista y sí tiene que contar.
   */
  const sent = useRef<string | null>(null);

  useEffect(() => {
    const key = JSON.stringify(event);
    if (sent.current === key) return;

    const visitor = visitorId();
    // Sin sitio donde guardar el identificador no se emite nada. Un evento sin
    // él no sería anónimo, sería incontable: engordaría el denominador de la
    // North Star sin poder entrar nunca en su numerador.
    if (visitor === null) return;

    sent.current = key;

    void fetch("/api/gap-view", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...event, visitorId: visitor }),
      // Que la petición sobreviva a cerrar la pestaña justo después de leer la
      // caja, que es un final de visita perfectamente normal.
      keepalive: true,
    }).catch(() => {
      // La telemetría no informa de sus fallos a quien está leyendo su Player
      // Gap: no es información suya y no puede hacer nada con ella.
    });
  }, [event]);

  return null;
}
