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
    /** El conmutador nombra la lengua a la que lleva, escrita en esa lengua. */
    switchLanguage: "Español",
  },

  /**
   * La cláusula 2.m de la ToU de Blizzard, en la redacción cerrada por la §4.2
   * del brief. Va en el pie de todas las páginas y no se abrevia: la línea
   * completa es el requisito, no una versión corta que quepa mejor.
   */
  attribution:
    "Game data from the Blizzard® Developer APIs. One Rung is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment, Inc. World of Warcraft® and Blizzard® are trademarks of Blizzard Entertainment, Inc.",

  nav: {
    methodology: "Methodology",
    /** Etiquetas para lector de pantalla: la página tiene dos `nav` distintos. */
    siteLabel: "Site",
    trailLabel: "Breadcrumb",
  },

  home: {
    status: "The site is being built. There's nothing to look up yet.",
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
