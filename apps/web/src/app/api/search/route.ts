import { NextResponse, type NextRequest } from "next/server";

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
 * El límite por IP entra aquí y en la Server Action cuando se haga #71; hoy lo
 * que acota el daño es el colchón reservado del bucket (ADR 0013, decisión 5).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
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
