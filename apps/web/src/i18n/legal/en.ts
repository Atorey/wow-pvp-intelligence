/**
 * La política de privacidad, en su idioma fuente (ADR 0012, decisión 1).
 *
 * El inglés define la forma —`Legal = typeof en`— igual que el diccionario de
 * copy: una sección que falte o que sobre en español rompe el `typecheck`.
 */
export const en = {
  title: "Privacy",
  lead: "What this site collects, why, and how to ask us to stop.",

  site: {
    heading: "What this site is",
    paragraphs: [
      "One Rung publishes analytics about World of Warcraft PvP, built from data that Blizzard makes public through its Developer APIs. There are no accounts, no logins and nothing to sign up for.",
      'One Rung is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment, Inc. The data comes from Blizzard\'s APIs and is shown as it arrives, without any warranty as to its accuracy, completeness or availability — it is provided "as is".',
    ],
  },

  character: {
    heading: "Character data",
    paragraphs: [
      "We record what Blizzard publishes about a character: its name, realm, region, class, specialisation, rating, matches played, and the equipment and talents shown on its profile. We keep a history of those observations, because the whole point of the site is to describe how the data changes over time.",
      "We do not collect anything that ties a character to a person. No Battle.net account, no email address, no real identity, and no grouping of several characters as belonging to the same player. A character page describes a character and stops there.",
      "The legal basis is legitimate interest: showing public game data back to the community that generated it, in aggregate form. This policy is meant to sit alongside Blizzard's own privacy policy, not to replace it.",
      "Blizzard's API terms require that data be refreshed at least every thirty days. We do that by checking that each character still exists; the information of a character that no longer exists is deleted and stops being shown.",
    ],
  },

  measurement: {
    heading: "Usage measurement",
    paragraphs: [
      "We record one row every time the Player Gap box is rendered, with how it turned out: whether we could show a comparison and with what level of confidence. That single number is what tells us whether the site is useful and whether our data coverage is good enough.",
      "That row holds the outcome, the specialisation, the rating bracket and segment, the language, and an anonymous identifier for the browser. It does not hold your IP address, your browser's user agent, or which character you were looking at. Who reads whose page is not a product metric.",
      "The identifier is generated in your browser, is stored only there, expires after ninety days, and is never shared with anyone. It exists so that a week's worth of views can be counted as people rather than as page loads.",
      "This is first-party measurement for aggregate statistics only: nothing leaves our servers, there is no advertising, no profiling, no cross-site tracking and no third-party analytics service. That is why this site has no cookie banner — there is nothing to consent to.",
      "The legal basis is legitimate interest. To remove the identifier, clear this site's data in your browser; a new one is created on the next visit, and the old rows can no longer be linked to it.",
    ],
  },

  storage: {
    heading: "What is kept in your browser",
    paragraphs: [
      "Three things, all in local storage and none of them a cookie: the theme you chose, your last searches, and the measurement identifier described above.",
      "The first two never leave your browser — we cannot read them. Only the identifier travels, and only attached to the measurement described above. All three disappear when you clear this site's data.",
    ],
  },

  thirdParties: {
    heading: "Third parties",
    paragraphs: [
      "There is no analytics service, no advertising network and no social widget on this site. The typefaces are served from our own domain rather than from a font provider.",
      "There is one exception, and it is worth naming: item icons are loaded directly from Blizzard's own servers, because their terms do not allow us to re-host them. When a page shows an item icon, your browser requests that image from Blizzard, and Blizzard's privacy policy governs that request.",
      "The site runs on Netlify and its database is hosted on Supabase. Both act as providers on our behalf and neither uses the data for its own purposes.",
    ],
  },

  rights: {
    heading: "Your rights",
    paragraphs: [
      "You may ask what we hold, ask us to correct it, ask us to delete it, or object to the processing. That includes asking us to withdraw a character from the dataset entirely, which we do by deleting its information and its history.",
      "You may also lodge a complaint with your data protection authority.",
    ],
    contact: (address: string) => `Write to ${address}.`,
    contactPending:
      "The address for these requests is not published yet, because the site is not open to the public yet. It will be here before it is.",
  },

  changes: {
    heading: "Changes to this policy",
    paragraphs: [
      "Blizzard's API terms can change without notice, and this policy depends on them. When it changes, the date below changes with it.",
    ],
    updated: (date: string) => `Last updated: ${date}.`,
  },
};

export type Legal = typeof en;
