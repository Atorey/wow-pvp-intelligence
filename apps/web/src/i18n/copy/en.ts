/**
 * El copy en inglés, que es el idioma fuente (ADR 0012, decisión 1).
 *
 * Este fichero define **la forma** del diccionario: `Copy` es `typeof en`, así
 * que el español no puede inventarse una clave ni dejarse otra sin traducir sin
 * que `typecheck` lo diga. Se escribe aquí primero y se traduce después, nunca
 * al revés.
 *
 * Las reglas de voz están en la §3.6 del brief y no son cosméticas: nada de
 * verbos dirigidos al lector en el copy de datos, nada de superlativos, nada de
 * fechas, y "observed" en vez de "players" (§2.5).
 */
import type { GearSlot } from "@wowpvp/core";

export const en = {
  site: {
    name: "One Rung",
    tagline: "See what separates you from the next rung.",
    /**
     * Cómo se llama **este** idioma, escrito en él. El conmutador lee el del
     * idioma de destino, así que la página en inglés ofrece "Español". Cada
     * diccionario nombrando al otro se lee al revés en cuanto haya un tercero.
     */
    switchLanguage: "English",
  },

  /**
   * La no afiliación que pide la cláusula 2.m de la ToU de Blizzard, en la
   * redacción cerrada por la §4.2 del brief. Va en el pie de todas las páginas
   * y no se acorta más: lo que queda es el requisito, no una versión que quepa
   * mejor.
   *
   * La otra mitad de la cláusula —de dónde salen los datos— **ya no está
   * aquí**: se retiró de esta línea y su sitio previsto es la página de
   * metodología, que todavía no está escrita.
   */
  attribution:
    "One Rung is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment, Inc. World of Warcraft® and Blizzard® are trademarks of Blizzard Entertainment, Inc.",

  nav: {
    methodology: "Methodology",
    /**
     * Etiquetas para lector de pantalla. La página tiene varios `nav` y dos de
     * ellos son visibles a la vez: sin nombres distintos, un lector los anuncia
     * como "navegación Site" dos veces y no dice cuál es cuál.
     */
    siteLabel: "Site",
    footerLabel: "Site information",
    trailLabel: "Breadcrumb",
    /** Qué región y qué modalidad cubre todo lo que el sitio publica. */
    /** El interruptor del menú de pantalla estrecha. */
    menuLabel: "Menu",
    bracketsLabel: "Bracket",
    classesLabel: "Classes",
  },

  /**
   * El conmutador de tema (ADR 0025). "System" es una opción y no el hueco de
   * no haber elegido: quien delega en el sistema está eligiendo delegar, y
   * tiene que poder volver ahí después de haber probado los otros dos.
   */
  theme: {
    label: "Theme",
    light: "Light",
    dark: "Dark",
    system: "System",
  },

  home: {
    /**
     * El titular, partido en dos porque su segunda mitad se pinta en el acento.
     * Partirlo aquí y no en el componente es lo que deja decidir a cada lengua
     * **qué** se resalta: en inglés y en español la parte que importa no cae en
     * el mismo sitio de la frase, y un `slice()` por posición se rompería con
     * la primera traducción.
     *
     * Sin punto final: es un titular, no una frase. El punto vive en
     * `site.tagline`, que es la misma idea escrita como oración y es lo que sale
     * en la descripción de la página.
     */
    title: {
      lead: "Take your character to the",
      highlight: "next level",
    },
    /**
     * El titular y el subtítulo son la voz de portada, no copy de datos, y por
     * eso pueden dirigirse al lector: la §3.6 del brief acota su prohibición a
     * "el copy de datos", que es donde una frase en imperativo convierte una
     * correlación en un consejo. `copy.test.ts` los exime por su clave y sigue
     * vigilando todo lo demás, incluida cada cifra de la caja Player Gap.
     *
     * Escritos en español primero, al revés de lo que marca el ADR 0012: son la
     * copy de producto que decidió quien lleva el producto, y esto es la
     * traducción.
     */
    subtitle:
      "We analyse thousands of players to show you what they use, how they play and what you can improve",
    lead: "Population from the Solo Shuffle leaderboard, plus every character someone has looked up.",

    recent: {
      title: "Recent searches",
    },

    meta: {
      title: "What's being played",
      /**
       * El estado vacío nombra lo que faltará y no se disculpa: la §1.5 del
       * brief pide declarar con palabras lo que no hay, no dejar el hueco.
       */
      empty:
        "This reading isn't published yet. When it is, the specs observed in Solo Shuffle go here, with how many characters carry each one and what share of them sit above 2400.",
    },

    population: {
      title: "How many are playing each bracket",
      empty:
        "This reading isn't published yet. When it is, the number of distinct characters observed in each bracket over the last 7 days goes here.",
    },
  },

  search: {
    title: "Character search",
    realmLabel: "Realm",
    nameLabel: "Character name",
    /**
     * Ejemplos, no instrucciones.
     *
     * El reino va en su grafía canónica —minúsculas y con guiones, los acentos
     * intactos— porque es la forma que Blizzard acepta y la que el visitante va
     * a ver en la lista (ADR 0017). El nombre no hace falta que la lleve:
     * `nameSlug()` y `foldSlug()` pasan a minúsculas lo tecleado, así que
     * escribirlo como lo escribe el jugador no cuesta nada y se lee mejor.
     */
    realmPlaceholder: "twisting-nether",
    namePlaceholder: "Illidan",
    /** El buscador de un campo de la barra lateral. */
    quickLabel: "Search a character by name",
    quickPlaceholder: "Search character",
    submit: "Search",
    suggestionsLabel: "Suggestions",
    searching: "Looking…",
    /** Vacío es "no está en nuestra población", que no es "no existe". */
    noSuggestions: "No character with that name is in the population yet.",
    /** Cómo se nombra a un personaje que conocemos pero al que no le consta rating. */
    noRating: "No rating on record",
    incomplete: {
      title: "The search needs a realm and a name",
      body: "Without a realm there is nobody to ask about: the Blizzard API takes no bare name.",
    },
    ambiguous: {
      title: "Several characters match that name",
      body: "Their names differ only in their accents, and they are different characters.",
    },
    notFound: {
      title: "Blizzard doesn't know that character",
      body: "The realm or the name may be spelled another way.",
    },
    unavailable: {
      title: "That character couldn't be looked up right now",
      body: "The lookup ran out of its time and quota budget. Whether the character exists is not on record.",
    },
  },

  /** Lo que dice una página que ya tiene dirección y todavía no tiene contenido. */
  placeholder: {
    note: "This page has its address. Its content isn't built yet.",
  },

  player: {
    title: "Player profile",
    lead: "Rating, percentile, spec and activity, and what separates this character from the next rung.",

    /**
     * Un personaje del que no consta ni una observación. No es "no existe": por
     * debajo del corte de 5.000 del leaderboard solo entra al dataset quien ha
     * sido buscado, así que lo que falta es la búsqueda, no el personaje.
     */
    unknown: {
      title: "This character isn't in the population yet",
      body: "Nobody has looked them up here, and they haven't been seen on the ladder this season. A search asks Blizzard about them and adds them.",
      action: "Look this character up",
    },

    /**
     * El botón que vuelve a preguntarle a Blizzard. Lo que dice cuando el
     * perfil está fresco no es un error: es el TTL de §28 evitando que consultar
     * cinco veces al mismo personaje cueste cinco fichas de cuota compartida.
     */
    refresh: {
      action: "Refresh",
      fresh: (minutes: string) => `Looked up less than ${minutes} minutes ago.`,
      unavailable:
        "Blizzard couldn't be asked just now. What's below is the last observation on record.",
    },

    /** La observación de la que sale la ficha, fechada. */
    observedAt: (when: string) => `Observed ${when}`,
    season: (id: string) => `Season ${id}`,

    figures: {
      rating: "rating",
      peak: (rating: string) => `highest observed ${rating}`,
      matches: "played",
      /**
       * Solo comparable con su misma fuente: perfil y leaderboard no cuadran
       * (ADR 0008). La etiqueta va delante del número en las dos lenguas porque
       * en español "1 perdidas" no concuerda, y este diccionario no tiene
       * plurales que dependan de la cantidad (ADR 0020).
       */
      record: (won: string, lost: string) => `Won: ${won} · Lost: ${lost}`,
      itemLevel: "item level (equipped)",
      itemLevelMedian: (segment: string, median: string) => `${segment} median: ${median}`,
      percentile: "percentile in the spec",
      below: (below: string, observed: string) => `${below} of ${observed} below`,
    },

    /** El selector de spec. Un personaje juega varias, y cada una es otro bracket. */
    specs: {
      label: "Specs observed this season",
    },

    tabs: {
      label: "Profile sections",
      summary: "Summary",
      gear: "Gear",
    },

    /**
     * La caja Player Gap (§1 del brief). Los tres estados son tres layouts, no
     * tres colores, y el copy es la mitad de esa diferencia.
     */
    gap: {
      title: (segment: string) => `What separates you from ${segment}?`,
      subject: (spec: string, bracket: string, rating: string) =>
        `${spec} · ${bracket} · ${rating}`,
      segments: (own: string, target: string) => `You ${own} → target ${target}`,
      /**
       * "Profiles" y no "players": el denominador son los perfiles cuyo equipo
       * se ha podido leer, que son muchos menos que la gente que hay ahí arriba
       * (§2.5, decisión 6 del ADR 0011).
       */
      sampled: (sample: string, segment: string) => `${sample} profiles sampled in ${segment}`,
      confidence: {
        high: "Confidence: high",
        medium: "Confidence: medium",
        insufficient: "No comparison",
      },
      /**
       * El aviso de muestra reducida. Ocupa espacio y desplaza al contenido a
       * propósito: si se puede pasar por alto haciendo scroll, no cumple §13.4.
       */
      smallSample:
        "Small sample (30-99 profiles). These figures will move as more of this segment is sampled.",
      none: {
        title: "No comparison yet.",
        /**
         * Causa (a) con el contador a cero, que no es un caso raro al empezar
         * la temporada. Va aparte porque "Only 0 have reached" no es una frase:
         * el cero no se cuenta, se dice.
         */
        noneObserved: (spec: string, segment: string, needed: string) =>
          `No ${spec} has been observed in ${segment} this season. ${needed} are needed before a percentage means anything.`,
        /** Causa (a): la gente no ha llegado ahí arriba. No es cosa nuestra. */
        byPopulation: (observed: string, spec: string, segment: string, needed: string) =>
          `Only ${observed} ${spec} have reached ${segment} this season. ${needed} are needed before a percentage means anything.`,
        /**
         * Causa (c): de quien mira no tenemos perfil. Aparecer en el
         * leaderboard no trae equipo, y sin equipo suyo no hay nada que
         * comparar aunque el segmento de arriba esté muestreado.
         */
        bySubject:
          "This character's equipment hasn't been read yet. The ladder carries their rating and nothing else; a profile lookup carries the rest.",
        /** Causa (b): hay gente, lo que falta es su equipo. Sí es cosa nuestra. */
        bySampling: (population: string, loaded: string, segment: string, needed: string) =>
          `${population} characters are in ${segment}, but the gear of only ${loaded} of them has been loaded. ${needed} are needed. That's our sampling, not the population, and it's filling in.`,
      },
      /** §1.6: en el tramo abierto no hay escalón de arriba, y eso no es falta de muestra. */
      topSegment: {
        title: "There's no rung above this one.",
        body: "This character is in the open top segment, so there's no next segment to compare against.",
      },
      itemLevel: {
        label: "Item level (equipped)",
        reading: (player: string, segment: string, median: string) =>
          `You ${player} · ${segment} median ${median}`,
      },
      notCompared: "Not compared yet: talents, secondary stats, embellishments.",
      /**
       * La nota de causalidad, fija siempre que haya comparación. Dice qué es el
       * dato, no qué hacer con él (regla 3 del proyecto).
       */
      causality:
        "This describes a correlation between gear and rating segment. A correlation is not a cause.",
    },

    /** El bloque descriptivo: dónde cae el jugador en la población observada. */
    standing: {
      title: "Where you stand",
      sentence: (below: string, observed: string, spec: string, rating: string) =>
        `${below} of the ${observed} ${spec} observed this season are below ${rating}.`,
      /** La fracción manda y el porcentaje acompaña, nunca al revés (§2.5). */
      percentile: (value: string) => `That's the ${value}th percentile.`,
      segment: (segment: string) => `Segment ${segment}`,
      /**
       * Las dos cifras del bloque no cuentan a la misma gente y por eso se dice:
       * el percentil cuenta la temporada entera y los tamaños de segmento solo a
       * quien estuvo activo en la ventana. Sin esta línea se leerían como partes
       * del mismo total, y no suman.
       */
      segmentsNote: (days: string) =>
        `Segment sizes count who has been active in the last ${days} days; the figure above counts the whole season.`,
      highest: "Highest observed rating",
      observedNote: "Observed = seen on the ladder or looked up here. Not every player.",
      /**
       * La limitación de origen, dicha donde sale la cifra y no solo detrás del
       * enlace de metodología (§14 del plan). Se escribe autosuficiente: el
       * enlace existe, pero la página al final de ese enlace es de #20 y hoy
       * está vacía.
       *
       * Describe el techo, no lo justifica. Un "por eso" convertiría la
       * limitación en una excusa, y la §2.5 del brief no admite ni disculpa ni
       * verbo de recomendación en este bloque.
       */
      ladderCap:
        "Blizzard's leaderboard publishes the top 5,000 per spec and bracket. Below that cut, a character enters this dataset only when someone looks it up here.",
    },

    brackets: {
      title: "Other brackets",
      none: "This site only reads Solo Shuffle. 2v2, 3v3, RBG and BG Blitz aren't observed in this release.",
    },

    /** Una línea por ausencia, con su causa y su denominador. Sin fechas (§2.3). */
    missing: {
      title: "What's missing",
      /**
       * Cuando lo que falta es gente arriba, la primera línea no habla de gear:
       * decir "0 de 0 perfiles cargados" señalaría nuestro muestreo cuando el
       * muestreo no tiene a quien mirar todavía (§2.4, variante a).
       */
      population: {
        label: (segment: string) => `Characters in ${segment}`,
        body: (observed: string, needed: string) => `${observed} so far. ${needed} are needed.`,
      },
      /** Lo que falta cuando el lado que no tenemos es el del propio personaje. */
      subject: {
        label: "This character's gear",
        body: "Not read yet. It's what the comparison above needs.",
      },
      gear: {
        label: (segment: string) => `Gear of ${segment}`,
        body: (loaded: string, population: string) =>
          `${loaded} of ${population} profiles loaded. It's what the comparison above needs.`,
      },
      itemLevel: {
        label: (segment: string) => `Item level of ${segment}`,
        body: "Same reason: no profiles yet.",
      },
      talents: {
        label: "Talents",
        body: "The build code is on record, undecoded into nodes. It isn't compared in this release.",
      },
      stats: {
        label: "Secondary stats and embellishments",
        body: "The endpoints we read don't return them.",
      },
    },

    gear: {
      title: "Observed gear",
      /**
       * El equipo y el rating vienen de observaciones distintas del mismo
       * personaje, y el desfase se declara en vez de dejarlo suponer.
       */
      note: (when: string) =>
        `This is the reading from ${when}, when their last update was recorded. An item with no icon keeps its slot: the name and the item level are the information.`,
      empty:
        "No equipment has been read for this character in this bracket. The leaderboard doesn't carry gear; a profile lookup does.",
      /**
       * Cómo se escribe cada slot. La clave es el vocabulario de Blizzard, que
       * es el que guarda la columna y con el que se cuenta la adopción por slot.
       */
      slots: {
        HEAD: "Head",
        NECK: "Neck",
        SHOULDER: "Shoulders",
        BACK: "Back",
        CHEST: "Chest",
        WRIST: "Wrists",
        HANDS: "Hands",
        WAIST: "Waist",
        LEGS: "Legs",
        FEET: "Feet",
        FINGER_1: "Ring",
        FINGER_2: "Ring",
        TRINKET_1: "Trinket",
        TRINKET_2: "Trinket",
        MAIN_HAND: "Weapon",
        OFF_HAND: "Off hand",
        SHIRT: "Shirt",
        TABARD: "Tabard",
      } satisfies Record<GearSlot, string>,
    },

    methodology: "How we count this → Methodology",
  },

  spec: {
    lead: (spec: string) => `Representation and observed gear for ${spec}.`,
    inBracket: (spec: string, bracket: string) =>
      `Representation and observed gear for ${spec} in ${bracket}.`,
    inSegment: (spec: string, bracket: string, segment: string) =>
      `Observed gear for ${spec} at ${segment} in ${bracket}.`,
  },

  methodology: {
    title: "Methodology",
    lead: "Where the data comes from, how the segments and percentiles are calculated, and what each confidence level means.",
  },

  notFound: {
    title: "There's nothing at this address",
    body: "It may be mistyped, or it may name a spec, a bracket or a rating segment that this site doesn't publish.",
    back: "Go to the home page",
  },
};

export type Copy = typeof en;
