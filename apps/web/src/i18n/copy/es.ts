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
    privacy: "Privacidad",
    siteLabel: "Sitio",
    footerLabel: "Información del sitio",
    trailLabel: "Ruta de navegación",
    menuLabel: "Menú",
    bracketsLabel: "Modalidad",
    classesLabel: "Clases",
    segmentsLabel: "Tramos de rating",
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

    unknown: {
      title: "Este personaje todavía no está en la población",
      body: "Nadie lo ha consultado aquí y no se le ha visto en la ladder esta temporada. Una búsqueda le pregunta a Blizzard por él y lo añade.",
      action: "Buscar este personaje",
    },

    refresh: {
      action: "Actualizar",
      fresh: (minutes) => `Consultado hace menos de ${minutes} minutos.`,
      unavailable:
        "Ahora mismo no se ha podido preguntar a Blizzard. Lo de abajo es la última observación registrada.",
    },

    observedAt: (when) => `Observado ${when}`,
    season: (id) => `Temporada ${id}`,

    figures: {
      rating: "rating",
      peak: (rating) => `máximo observado ${rating}`,
      matches: "partidas",
      record: (won, lost) => `Ganadas: ${won} · Perdidas: ${lost}`,
      itemLevel: "item level equipado",
      itemLevelMedian: (segment, median) => `mediana de ${segment}: ${median}`,
      percentile: "percentil en la spec",
      below: (below, observed) => `${below} de ${observed} por debajo`,
    },

    specs: {
      label: "Specs observadas esta temporada",
    },

    tabs: {
      label: "Secciones del perfil",
      summary: "Resumen",
      gear: "Equipamiento",
    },

    gap: {
      title: (segment) => `¿Qué te separa de ${segment}?`,
      subject: (spec, bracket, rating) => `${spec} · ${bracket} · ${rating}`,
      segments: (own, target) => `Tú ${own} → objetivo ${target}`,
      sampled: (sample, segment) => `${sample} perfiles muestreados en ${segment}`,
      confidence: {
        high: "Confianza alta",
        medium: "Confianza media",
        insufficient: "Sin comparación",
      },
      smallSample:
        "Muestra reducida (30-99 perfiles). Estas cifras se moverán según se muestree más este segmento.",
      none: {
        title: "Todavía no hay comparación.",
        noneObserved: (spec, segment, needed) =>
          `Todavía no hemos observado a ningún ${spec} en ${segment} esta temporada. Hacen falta ${needed} antes de que un porcentaje signifique algo.`,
        bySubject:
          "Todavía no se ha leído el equipamiento de este personaje. La ladder trae su rating y nada más; una consulta de perfil trae el resto.",
        byPopulation: (observed, spec, segment, needed) =>
          `Solo ${observed} ${spec} han llegado a ${segment} esta temporada. Hacen falta ${needed} antes de que un porcentaje signifique algo.`,
        bySampling: (population, loaded, segment, needed) =>
          `Hay ${population} personajes en ${segment}, pero solo se ha cargado el equipamiento de ${loaded} de ellos. Hacen falta ${needed}. Lo que falta es nuestro muestreo, no la población, y se va corrigiendo.`,
      },
      topSegment: {
        title: "No hay ningún nivel por encima de este.",
        body: "Este personaje está en el tramo abierto de arriba, así que no hay segmento siguiente con el que compararlo.",
      },
      itemLevel: {
        label: "Item level equipado",
        reading: (player, segment, median) => `Tú ${player} · mediana de ${segment} ${median}`,
      },
      overlap: {
        label: "Solapamiento de equipo",
        reading: (percent, segment, items) =>
          `Tus objetos los lleva de media el ${percent} de ${segment} (${items} objetos comparados)`,
      },
      list: {
        gear: (segment) => `Lo que más se lleva en ${segment}`,
        talents: (segment) => `Los nodos más frecuentes en ${segment}`,
        targetShare: (percent, users, denominator) =>
          `${percent} (${users} de ${denominator}) ahí arriba`,
        ownShare: (percent, users, denominator) =>
          `${percent} (${users} de ${denominator}) en tu tramo`,
        youHaveIt: "Lo llevas",
        empty: (threshold) => `Nada difiere más de ${threshold} entre los dos segmentos.`,
        unavailable: (count, segment) =>
          `${count} perfiles de ${segment} quedan fuera de estos porcentajes: de ellos no había dato.`,
      },
      absence: {
        gear: "Diferencias de equipo",
        talents: "Nodos de talento",
        target: (sample, segment, needed) =>
          `Todavía no se compara: ${sample} perfiles leídos en ${segment}, y hacen falta ${needed}.`,
        own: (sample, segment, needed) =>
          `Todavía no se compara: en tu propio tramo (${segment}) hay ${sample} perfiles leídos y hacen falta ${needed}. Cada fila dice los dos porcentajes.`,
      },
      kinds: {
        gem: "Gema",
        enchant: "Encantamiento",
      },
      trees: {
        class: "Clase",
        spec: "Especialización",
        hero: "Héroe",
        pvp: "PvP",
      },
      notCompared: "Sin comparar todavía: stats secundarias y embellecimientos.",
      causality:
        "Esto describe una correlación entre lo que se lleva y el segmento de rating. Una correlación no es una causa.",
    },

    standing: {
      title: "Posición en la spec",
      sentence: (below, observed, spec, rating) =>
        `${below} de los ${observed} ${spec} que hemos observado esta temporada están por debajo de ${rating}.`,
      percentile: (value) => `Percentil ${value}.`,
      segment: (segment) => `Segmento ${segment}`,
      segmentsNote: (days) =>
        `Los tamaños de segmento cuentan a quien ha estado activo los últimos ${days} días; la cifra de arriba cuenta la temporada entera.`,
      highest: "Rating más alto observado",
      observedNote: "Observado = visto en la ladder o consultado aquí. No son todos los jugadores.",
      ladderCap:
        "El leaderboard de Blizzard publica los 5.000 primeros de cada spec y modalidad. Por debajo de ese corte, un personaje entra en estos datos solo cuando alguien lo busca aquí.",
    },

    brackets: {
      title: "Otras modalidades",
      none: "Este sitio solo lee Solo Shuffle. 2v2, 3v3, RBG y BG Blitz no se observan en esta versión.",
    },

    missing: {
      title: "Qué falta",
      population: {
        label: (segment) => `Personajes en ${segment}`,
        body: (observed, needed) => `${observed} hasta ahora. Hacen falta ${needed}.`,
      },
      subject: {
        label: "Gear de este personaje",
        body: "Todavía sin leer. Es lo que necesita la comparación de arriba.",
      },
      gear: {
        label: (segment) => `Gear del segmento ${segment}`,
        body: (loaded, population) =>
          `${loaded} de ${population} perfiles cargados. Es lo que necesita la comparación de arriba.`,
      },
      itemLevel: {
        label: (segment) => `Item level del segmento ${segment}`,
        body: "Por la misma razón: todavía no hay perfiles.",
      },
      talents: {
        label: "Talentos",
        body:
          "Los nodos de la build ya se agregan por segmento. Lo que falta es la comparación con " +
          "el escalón de arriba, así que los talentos no se comparan en esta versión.",
      },
      stats: {
        label: "Stats secundarias y embellecimientos",
        body: "Los endpoints que leemos no los devuelven.",
      },
    },

    gear: {
      title: "Equipamiento observado",
      note: (when) =>
        `Es la lectura del ${when}, cuando se registró su última actualización. Un item sin icono conserva su hueco: el nombre y el item level son la información.`,
      empty:
        "No se ha leído el equipamiento de este personaje en esta modalidad. El leaderboard no lo trae; una consulta de perfil sí.",
      /*
       * "Off hand" se queda en inglés como el resto de la terminología del juego
       * (§3.2 del brief): es como lo nombra quien juega, también en español.
       */
      slots: {
        HEAD: "Cabeza",
        NECK: "Cuello",
        SHOULDER: "Hombros",
        BACK: "Capa",
        CHEST: "Pecho",
        WRIST: "Muñecas",
        HANDS: "Manos",
        WAIST: "Cintura",
        LEGS: "Piernas",
        FEET: "Pies",
        FINGER_1: "Anillo",
        FINGER_2: "Anillo",
        TRINKET_1: "Abalorio",
        TRINKET_2: "Abalorio",
        MAIN_HAND: "Arma",
        OFF_HAND: "Off hand",
        SHIRT: "Camisa",
        TABARD: "Tabardo",
      },
    },

    methodology: "Cómo se calcula esto → Metodología",
  },

  spec: {
    lead: (spec) => `Representación y gear observado de ${spec}.`,
    inBracket: (spec, bracket) => `Representación y gear observado de ${spec} en ${bracket}.`,
    inSegment: (spec, bracket, segment) =>
      `Gear observado de ${spec} en el tramo ${segment} de ${bracket}.`,
    previousSegment: "Tramo de abajo",
    nextSegment: "Tramo de arriba",
  },

  notFound: {
    title: "En esta dirección no hay nada",
    body: "Puede estar mal escrita, o nombrar una spec, un bracket o un segmento de rating que este sitio no publica.",
    back: "Ir a la página de inicio",
  },
};
