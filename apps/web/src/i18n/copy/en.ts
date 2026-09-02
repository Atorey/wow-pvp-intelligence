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
