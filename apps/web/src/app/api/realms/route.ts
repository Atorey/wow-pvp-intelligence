import { NextResponse } from "next/server";

import { knownRealms } from "../../../server/search";

/**
 * Los reinos que conocemos, para el campo de reino del buscador.
 *
 * Vive fuera de `/[locale]` por lo mismo que `/api/search`: un `realm_slug` es
 * el mismo en los dos idiomas y prefijarlo obligaría a mantener dos URL para
 * una respuesta idéntica.
 *
 * Se sirve la lista completa y el navegador filtra. La alternativa —una consulta
 * por pulsación— gastaría una conexión a Postgres por letra para recortar unos
 * kilobytes que ya están en el cliente.
 */
export async function GET(): Promise<NextResponse> {
  const realms = await knownRealms();

  return NextResponse.json(
    { realms },
    {
      headers: {
        // Mucho más larga que la de las sugerencias: la lista de reinos cambia
        // cuando aparece el primer personaje de un reino nuevo, no con cada
        // búsqueda. `stale-while-revalidate` evita que la primera visita tras
        // expirar pague la consulta.
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
