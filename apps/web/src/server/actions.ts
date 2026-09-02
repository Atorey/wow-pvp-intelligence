"use server";

import { playerPath, searchPath } from "@wowpvp/core";
import { redirect } from "next/navigation";
import { SOURCE_LOCALE, isLocale, localizedPathname } from "../i18n/locales";
import { resolveSearch } from "./search";

/**
 * Lo que ocurre al enviar el buscador (ADR 0024, decisión 2).
 *
 * Es una Server Action y no un `GET` a una página por una razón concreta: esto
 * **escribe**. Cuando el personaje no está en la población se le pregunta a
 * Blizzard y lo que responde entra al dataset; un efecto así colgado de un `GET`
 * lo dispararía cualquier precarga del navegador o del propio Next, y cada
 * disparo cuesta cuota compartida con el pipeline.
 *
 * Sin JavaScript funciona igual: el formulario hace POST y Next enruta hasta
 * aquí. Es la razón de que el buscador sea un `<form>` de verdad.
 */
export async function submitSearch(formData: FormData): Promise<never> {
  const field = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  const written = field("locale");
  const locale = isLocale(written) ? written : SOURCE_LOCALE;
  const realm = field("realm");
  const name = field("name");

  const landing = (status?: Parameters<typeof searchPath>[0]["status"]): string =>
    localizedPathname(searchPath({ realm, name, ...(status ? { status } : {}) }), locale);

  // Un envío a medias no gasta una llamada: sin reino no hay a quién preguntar,
  // porque la API de Blizzard no sabe buscar por nombre suelto.
  if (!realm || !name) redirect(landing());

  const resolution = await resolveSearch({ realm, name });

  if (resolution.status === "found") {
    redirect(localizedPathname(playerPath(resolution.route), locale));
  }

  // Los otros tres estados se enseñan en /search, con el resultado en la URL: la
  // página los pinta sin volver a preguntar, así que refrescarla no cuesta otra
  // llamada ni convierte un "no se pudo mirar" en un "no existe".
  redirect(landing(resolution.status));
}
