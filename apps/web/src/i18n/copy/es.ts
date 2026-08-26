/**
 * El copy en español: traducción del inglés, nunca al revés (ADR 0012).
 *
 * `Copy` viene del inglés, así que una clave que falte o que sobre rompe el
 * `typecheck` en vez de aparecer en pantalla en el idioma equivocado.
 *
 * Dos reglas de la §3.7 del brief mandan aquí más que la fidelidad literal:
 * la terminología del juego se queda en inglés —`rating`, `gear`, `spec`,
 * `bracket`, `Solo Shuffle`— y "para" + infinitivo está prohibido, porque
 * introduce finalidad y la finalidad es causalidad (regla 3 del proyecto).
 */
import type { Copy } from "./en";

export const es: Copy = {
  site: {
    name: "One Rung",
    tagline: "Mira qué te separa del siguiente escalón.",
    switchLanguage: "English",
  },

  attribution:
    "Datos del juego obtenidos de las Blizzard® Developer APIs. One Rung no está afiliado a Blizzard Entertainment, Inc., ni cuenta con su respaldo ni con su patrocinio. World of Warcraft® y Blizzard® son marcas de Blizzard Entertainment, Inc.",

  nav: {
    methodology: "Metodología",
    siteLabel: "Sitio",
    trailLabel: "Ruta de navegación",
  },

  home: {
    status: "El sitio está en construcción. Todavía no hay nada que consultar.",
  },

  placeholder: {
    note: "Esta página ya tiene su dirección. Su contenido todavía no está construido.",
  },

  player: {
    title: "Perfil de jugador",
    lead: "Rating, percentil, spec y actividad, y qué separa a este personaje del siguiente escalón.",
  },

  spec: {
    lead: (spec) => `Representación y gear observado de ${spec}.`,
    inBracket: (spec, bracket) => `Representación y gear observado de ${spec} en ${bracket}.`,
    inSegment: (spec, bracket, segment) =>
      `Gear observado de ${spec} en el tramo ${segment} de ${bracket}.`,
  },

  methodology: {
    title: "Metodología",
    lead: "De dónde salen los datos, cómo se calculan los segmentos y los percentiles, y qué significa cada nivel de confianza.",
  },

  notFound: {
    title: "En esta dirección no hay nada",
    body: "Puede estar mal escrita, o nombrar una spec, un bracket o un segmento de rating que este sitio no publica.",
    back: "Ir a la página de inicio",
  },
};
