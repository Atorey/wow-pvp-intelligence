"use server";

import { playerPath, resolvePlayerRoute, searchPath } from "@wowpvp/core";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { SOURCE_LOCALE, isLocale, localizedPathname } from "../i18n/locales";
import { checkLimit } from "./rate-limit";
import { type RefreshStatus, refreshCharacter } from "./refresh";
import { resolveSearch } from "./search";

/*
 * `headers()` aparece aquí y en ningún sitio más, y es compatible con el motivo
 * por el que `not-found.tsx` lo evita: allí marcaría dinámica la rama entera que
 * cuelga del layout y sacaría la portada de la generación en build. Una Server
 * Action es un manejador de POST — no se genera estáticamente nunca y no
 * participa del render de ningún layout.
 */

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
  // porque la API de Blizzard no sabe buscar por nombre suelto. Va antes del
  // límite porque tampoco tiene por qué gastar ficha.
  if (!realm || !name) redirect(landing());

  // El límite no puede envolverse en un `try`: `redirect()` funciona lanzando, y
  // un `catch` alrededor se lo tragaría. Lo que se rinde ante un fallo es
  // `checkLimit` por dentro.
  if (await checkLimit("submit", await headers())) redirect(landing("rate-limited"));

  const resolution = await resolveSearch({ realm, name });

  if (resolution.status === "found") {
    redirect(localizedPathname(playerPath(resolution.route), locale));
  }

  // Los otros estados se enseñan en /search, con el resultado en la URL: la
  // página los pinta sin volver a preguntar, así que refrescarla no cuesta otra
  // llamada ni convierte un "no se pudo mirar" en un "no existe".
  redirect(landing(resolution.status));
}

/**
 * Lo que ocurre al pulsar "Actualizar" en un perfil.
 *
 * Es una Server Action por lo mismo que el buscador: vuelve a preguntarle a
 * Blizzard y lo que responde entra al dataset. Colgado de un `GET`, cada
 * precarga del navegador sobre un enlace al perfil gastaría cuota compartida
 * con el pipeline, y bastaría con recargar la página para volver a gastarla.
 *
 * Vuelve al mismo perfil con el resultado en la URL —la misma forma que usa
 * `/search`— para que refrescar la página después no dispare otra llamada.
 */
export async function refreshPlayer(formData: FormData): Promise<never> {
  const field = (key: string): string => {
    const value = formData.get(key);
    return typeof value === "string" ? value.trim() : "";
  };

  const written = field("locale");
  const locale = isLocale(written) ? written : SOURCE_LOCALE;

  const resolution = resolvePlayerRoute({
    region: field("region"),
    realm: field("realm"),
    name: field("name"),
  });
  // El formulario lleva la identidad ya canónica, así que aquí solo puede
  // llegar algo que no lo sea si alguien lo ha reescrito: no hay a quién
  // actualizar y tampoco a dónde volver.
  if (resolution.status !== "canonical") notFound();

  const limited = await checkLimit("submit", await headers());
  const status: RefreshStatus = limited ? "rate-limited" : await refreshCharacter(resolution.route);

  const query = new URLSearchParams({ refresh: status });
  const spec = field("spec");
  if (spec) query.set("spec", spec);
  const tab = field("tab");
  if (tab) query.set("tab", tab);

  redirect(`${localizedPathname(playerPath(resolution.route), locale)}?${query.toString()}`);
}
