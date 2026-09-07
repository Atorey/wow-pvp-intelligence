import { NextResponse, type NextRequest } from "next/server";

import { checkLimit, retryAfterSeconds } from "../../../server/rate-limit";
import { suggest } from "../../../server/search";

/**
 * Las sugerencias del autocompletado (§21 del plan, ADR 0024).
 *
 * Vive fuera de `/[locale]` a propósito: devuelve identidades, que son las
 * mismas en los dos idiomas, y prefijarla obligaría a mantener dos URL para una
 * respuesta idéntica. Por eso `src/proxy.ts` deja `/api` fuera de su matcher.
 *
 * Aquí **no** se llama a Blizzard, y no es un olvido: esto se ejecuta una vez
 * por pulsación de teclado y la cuota es la misma que gasta el pipeline. Lo
 * único que puede tocar la API es el envío del formulario, que es un POST y una
 * decisión de quien busca.
 *
 * Aun sin tocar la API, lleva límite por IP (ADR 0030): una consulta por
 * pulsación es una consulta a Postgres por pulsación, y no hace falta un bot
 * para eso, basta con mantener una tecla pulsada.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const limited = await checkLimit("suggest", request.headers);
  if (limited) {
    // Sin sugerencias es una respuesta que el cliente ya sabe pintar, así que el
    // buscador se degrada a lo que es sin JavaScript en vez de romperse.
    return NextResponse.json(
      { suggestions: [] },
      {
        status: 429,
        headers: {
          "Retry-After": retryAfterSeconds(limited.retryAfterMs),
          // Sin esto heredaría el `max-age` de la respuesta buena y una caché
          // intermedia serviría el límite de una persona a todo el mundo.
          "Cache-Control": "no-store",
          "X-Robots-Tag": "noindex",
        },
      },
    );
  }

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const realm = request.nextUrl.searchParams.get("realm");

  const suggestions = await suggest(query, realm);

  return NextResponse.json(
    { suggestions },
    {
      headers: {
        // Una respuesta corta y compartible: quien teclea las mismas letras en
        // el mismo minuto no tiene por qué costar otra consulta. Es corta
        // porque la población crece con cada búsqueda de cualquiera.
        "Cache-Control": "public, max-age=60",
        // No es una página y no tiene por qué aparecer en ningún índice.
        "X-Robots-Tag": "noindex",
      },
    },
  );
}
