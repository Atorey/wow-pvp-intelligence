import { NextResponse, type NextRequest } from "next/server";

import { localeFromPathname, localizedPathname, negotiateLocale } from "./i18n/locales";

/**
 * No existe la versión sin prefijo (ADR 0012, decisión 2): toda ruta que llegue
 * sin `/en` o `/es` delante se redirige a una que lo lleve.
 */
export function proxy(request: NextRequest): NextResponse {
  if (localeFromPathname(request.nextUrl.pathname)) return NextResponse.next();

  const locale = negotiateLocale(request.headers.get("accept-language"));
  const target = request.nextUrl.clone();
  target.pathname = localizedPathname(request.nextUrl.pathname, locale);

  // 302 y nunca 301: un permanente se queda pegado en la caché del navegador y
  // en la de Google, y fija para todo el mundo la preferencia de idioma del
  // primer visitante que pasó por aquí.
  const response = NextResponse.redirect(target, 302);
  // La respuesta depende de un encabezado de petición, así que cualquier caché
  // intermedia tiene que saberlo o servirá el idioma del visitante anterior.
  response.headers.set("Vary", "Accept-Language");
  return response;
}

export const config = {
  matcher: [
    // Todo menos lo que no es una página: estáticos de Next, imágenes
    // optimizadas y los ficheros que los buscadores piden en la raíz.
    "/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
  ],
};
