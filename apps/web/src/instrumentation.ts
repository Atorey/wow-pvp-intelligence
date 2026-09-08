import type { Instrumentation } from "next";

import { logServerEvent } from "./server/log";

/**
 * Quién se entera de que una página ha reventado (ADR 0030).
 *
 * `onRequestError` es el hook de servidor de Next para los fallos de render, y
 * es el sitio correcto: el `error.tsx` se ejecuta en el navegador de quien se lo
 * ha encontrado, así que lo que registre desde allí depende de que su navegador
 * quiera contárnoslo. Esto corre en la función, siempre.
 *
 * **La ruta se registra por su forma, nunca resuelta.** Next entrega en
 * `context.routePath` el patrón (`/[locale]/player/[region]/[realm]/[name]`) y
 * en `request.path` la dirección real, que en un perfil **lleva dentro el nombre
 * del personaje**. Guardar la segunda convertiría estos registros en el historial
 * de visitas que la política de privacidad promete que no existe (ADR 0028,
 * decisión 5). Se registra la primera, que dice qué se rompió sin decir a quién.
 *
 * Por lo mismo no se registra ni la IP ni el user-agent, que también viajan en
 * `request` y aquí se ignoran a propósito.
 */
export const onRequestError: Instrumentation.onRequestError = (err, request, context) => {
  logServerEvent("render-error", {
    // El patrón de ruta, no la ruta. Si algún día Next dejara de darlo, lo
    // correcto es registrar `null` y no caer a `request.path`.
    route: context.routePath ?? null,
    method: request.method,
    // Renderizando en servidor o revalidando por detrás: cambia quién estaba
    // esperando, y por tanto la urgencia.
    renderSource: context.renderSource ?? null,
    routeType: context.routeType,
    message: err instanceof Error ? err.message : String(err),
    // La traza recortada: entera puede ser de miles de líneas y el marco que
    // dice dónde falló está siempre arriba.
    stack: err instanceof Error ? (err.stack?.slice(0, 2000) ?? null) : null,
  });
};
