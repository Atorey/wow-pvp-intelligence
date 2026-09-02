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

/*
 * "Nivel" y no "escalón": el producto se llama One Rung, pero `rung` no tiene
 * en español una traducción que el jugador use. "Escalón" es correcto y no lo
 * dice nadie; el glosario de quien juega dice "nivel". La marca no se traduce,
 * así que la metáfora vive en el nombre y el copy habla como se habla.
 */
export const es: Copy = {
  site: {
    name: "One Rung",
    tagline: "Mira qué te separa del siguiente nivel.",
    switchLanguage: "Español",
  },

  attribution:
    "One Rung no está afiliado a Blizzard Entertainment, Inc., ni cuenta con su respaldo ni con su patrocinio. World of Warcraft® y Blizzard® son marcas de Blizzard Entertainment, Inc.",

  nav: {
    methodology: "Metodología",
    siteLabel: "Sitio",
    footerLabel: "Información del sitio",
    trailLabel: "Ruta de navegación",
    menuLabel: "Menú",
    bracketsLabel: "Modalidad",
    classesLabel: "Clases",
  },

  theme: {
    label: "Tema",
    light: "Claro",
    dark: "Oscuro",
    system: "Sistema",
  },

  home: {
    title: {
      lead: "Lleva tu personaje al",
      highlight: "siguiente nivel",
    },
    subtitle:
      "Analizamos miles de jugadores para mostrarte qué usan, cómo juegan y qué puedes mejorar",
    lead: "Población del leaderboard de Solo Shuffle, más todos los personajes que alguien ha consultado.",

    recent: {
      title: "Búsquedas recientes",
    },

    meta: {
      title: "Qué se juega ahora",
      empty:
        "Esta lectura todavía no está publicada. Cuando lo esté, aquí estarán las specs observadas en Solo Shuffle, con cuántos personajes las llevan y qué proporción de ellos pasa de 2400.",
    },

    population: {
      title: "Cuánta gente hay en cada modalidad",
      empty:
        "Esta lectura todavía no está publicada. Cuando lo esté, aquí estará cuántos personajes distintos se han observado en cada modalidad en los últimos 7 días.",
    },
  },

  search: {
    title: "Búsqueda de personaje",
    realmLabel: "Reino",
    nameLabel: "Nombre del personaje",
    realmPlaceholder: "twisting-nether",
    namePlaceholder: "Illidan",
    quickLabel: "Buscar un personaje por su nombre",
    quickPlaceholder: "Buscar personaje",
    submit: "Buscar",
    suggestionsLabel: "Sugerencias",
    searching: "Buscando…",
    noSuggestions: "Ningún personaje con ese nombre está todavía en la población.",
    noRating: "Sin rating registrado",
    incomplete: {
      title: "La búsqueda necesita un reino y un nombre",
      body: "Sin reino no hay a quién preguntar: la API de Blizzard no admite un nombre suelto.",
    },
    ambiguous: {
      title: "Varios personajes casan con ese nombre",
      body: "Sus nombres solo se diferencian en los acentos, y son personajes distintos.",
    },
    notFound: {
      title: "Blizzard no conoce ese personaje",
      body: "El reino o el nombre pueden estar escritos de otra forma.",
    },
    unavailable: {
      title: "Ahora mismo no se ha podido consultar",
      body: "La consulta agotó su presupuesto de tiempo y de cuota. No consta si el personaje existe.",
    },
  },

  placeholder: {
    note: "Esta página ya tiene su dirección. Su contenido todavía no está construido.",
  },

  player: {
    title: "Perfil de jugador",
    lead: "Rating, percentil, spec y actividad, y qué separa a este personaje del siguiente nivel.",
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
