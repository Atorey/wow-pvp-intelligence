import { NextResponse, type NextRequest } from "next/server";

import { parseGapViewEvent } from "../../../analytics/gap-view";
import { recordGapView } from "../../../server/gap-views";
import { logServerEvent } from "../../../server/log";

/**
 * Donde aterriza el evento de la North Star (§35 del plan, ADR 0028).
 *
 * Vive fuera de `/[locale]` como los otros dos handlers —el idioma es un campo
 * del evento, no una URL distinta— y por eso `src/proxy.ts` deja `/api` fuera
 * de su matcher.
 *
 * Es un `POST` y no un `GET` porque escribe, y eso lo mantiene fuera de
 * precargas y de cualquier caché intermedia que convertiría una vista en varias.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = null;
  }

  const event = parseGapViewEvent(body);
  // Lo que no encaja no se escribe y no se explica: este endpoint está abierto
  // y una respuesta que detalle qué campo falló es un manual para llenar la
  // tabla de filas creíbles. El límite por peticiones e IP es de #71.
  if (event === null)
    return NextResponse.json({ error: "invalid" }, { status: 400, headers: NO_TRACE });

  try {
    await recordGapView(event);
  } catch (err) {
    // Un fallo de escritura cuesta una fila de métrica. Devolver un error se lo
    // contaría al navegador de quien está leyendo su Player Gap, que no puede
    // hacer nada con esa información y no ha pedido nada.
    //
    // Callarlo del todo sí tenía precio: la North Star se mide sobre esta tabla,
    // y un cociente calculado sobre filas que se perdieron en silencio parece
    // sano justo cuando no lo está. Del evento solo sale el desenlace, que es
    // lo que dice si lo que falla es una rama concreta; nada de quien lo emitió.
    logServerEvent("gap-view-write-failed", {
      outcome: event.outcome,
      message: err instanceof Error ? err.message : String(err),
    });
  }

  return new NextResponse(null, { status: 204, headers: NO_TRACE });
}

const NO_TRACE = {
  // Ni se cachea ni se indexa: no es una página y su respuesta no dice nada.
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex",
};
