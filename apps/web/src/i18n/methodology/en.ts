/**
 * La página de metodología, en su idioma fuente (ADR 0012, decisión 1).
 *
 * El documento es una **función de sus cifras**, no un texto con números
 * escritos dentro: los umbrales llegan ya formateados desde `index.ts`, que los
 * saca de `@wowpvp/core`. Un "30" tecleado en un párrafo sobrevive a que alguien
 * mueva `MIN_SAMPLE_MEDIUM` y deja la página explicando una aritmética que el
 * sitio ya no hace, que es exactamente lo contrario de lo que esta página es.
 */
import type { MethodologySection } from "@wowpvp/core";

/** Los umbrales del dominio, ya escritos en la lengua de la página. */
export interface Thresholds {
  /** `MIN_SAMPLE_HIGH`. */
  readonly high: string;
  /** `MIN_SAMPLE_MEDIUM`. */
  readonly medium: string;
  /** `MIN_DISCRIMINATIVE_DELTA`, en puntos porcentuales. */
  readonly deltaPoints: string;
  /** La anchura de un tramo de rating. */
  readonly segmentSize: string;
}

export interface Section {
  readonly heading: string;
  readonly paragraphs: readonly string[];
}

export interface MethodologyDocument {
  readonly title: string;
  readonly lead: string;
  /**
   * Los apartados van por clave y no en una lista: el orden y los `id` los pone
   * el catálogo de `@wowpvp/core`, que es lo que enlazan otras páginas, y un
   * apartado que falte en una lengua rompe el `typecheck` en vez de desaparecer.
   */
  readonly sections: Record<MethodologySection, Section>;
  readonly updated: (date: string) => string;
}

export function en(t: Thresholds): MethodologyDocument {
  return {
    title: "Methodology",
    lead: "Where the data comes from, how the segments and percentiles are calculated, and what each confidence level means.",

    sections: {
      sources: {
        heading: "Where the data comes from",
        paragraphs: [
          "Every figure on this site comes from the Blizzard® Developer APIs, the public interface Blizzard Entertainment, Inc. publishes for World of Warcraft®. Two endpoints do the work: the Solo Shuffle leaderboard, which lists the top of the ladder by specialization, and the character profile, which returns the gear and the talents a character was last seen with.",
          "Nothing here comes from an addon, from a log parser, or from a page scraped off another site, and no figure is ever typed in by hand. A number the API does not return is a number this site does not have.",
          "One Rung is not affiliated with, endorsed by, or sponsored by Blizzard Entertainment, Inc. The data arrives as it arrives, and that is how it goes out.",
        ],
      },

      observed: {
        heading: 'What "observed" means',
        paragraphs: [
          "This site says observed, never players. A character is observed once it has appeared in the leaderboard we read, or once somebody has looked it up here. Everyone else sits outside every count on this page, and how many that is cannot be known: Blizzard does not publish the size of the population.",
          "The leaderboard publishes 5,000 characters per specialization and bracket. Where that cut falls moves with the season — in a mature one the most played specializations fill their 5,000 slots well above the lower ratings, and the characters below never enter through the ladder at all. That is what the search box is there for: a character looked up here joins the observed population.",
          "Looking someone up does not move the percentages, though. Observations that arrive from a search are kept and counted separately, outside the aggregates, so that a specialization cannot look more common merely because the people reading about it went looking for it.",
          `Position inside a specialization is a count and not an estimate: how many observed characters of that specialization sit below a rating, out of how many were observed at all. The percentile is a label on top of that fraction, and it appears only once the bracket reaches ${t.medium} observed characters. Below that, the fraction goes out on its own.`,
        ],
      },

      segments: {
        heading: "How the segments are built",
        paragraphs: [
          `Ratings are grouped into bands of ${t.segmentSize} points — 1600-1800, 1800-2000, and so on up to an open band at the top. A band includes its lower bound and excludes the upper one, so a rating of exactly 2000 belongs to 2000-2200 and not to 1800-2000.`,
          "A comparison always runs against the band immediately above, never against the top of the ladder. When that band cannot be described — and often it cannot — the comparison is not quietly redirected at a further band that happens to be better covered.",
          "A character in the open band at the top has no band above it, and the page says so rather than comparing it against itself.",
        ],
      },

      confidence: {
        heading: "What confidence means",
        paragraphs: [
          `Three levels, and all three are counts rather than judgements. High: ${t.high} profiles or more behind the figure. Medium: at least ${t.medium}. Below ${t.medium} no comparison is shown at all, and the page explains which piece is missing instead.`,
          "The count that decides this is the one behind that specific figure, not the size of the segment. A band can hold thousands of characters and still have readable gear on none of them: population is not a basis for comparison, and the two are counted apart.",
          "The threshold is not lowered to fill an empty page. A comparison drawn from twelve profiles describes twelve people, and saying so out loud is what this page is for.",
        ],
      },

      numbers: {
        heading: "How a percentage is built",
        paragraphs: [
          "Every percentage travels with the fraction it came from — 74% (89/120), never a bare 74%. The fraction is the figure that carries the weight; the percentage is alongside it because it reads faster.",
          'Missing is not zero. When a profile returns no readable gear, or no talents, that profile leaves the denominator of that figure and the number of profiles that left is declared next to it. Counting it as "does not use it" would invent an answer nobody gave.',
          "Different figures rest on different denominators, and they are not interchangeable: gear, talent nodes and PvP talents are read from different parts of the same profile, and one of them can be absent while the others are there.",
          `Differences below ${t.deltaPoints} percentage points are not listed. At these sample sizes a gap that small is indistinguishable from sampling noise, so a short list is a result and not a gap in the layout.`,
        ],
      },

      correlation: {
        heading: "Correlation, not advice",
        paragraphs: [
          "What this site reports is what the band above wears and runs, and how many of them do. It does not report what makes anyone climb, because the data cannot answer that: nothing here compares a player against themselves before and after a decision, and a ladder is full of reasons no profile records.",
          'So the wording stays descriptive on purpose. "74% of 2000-2200 carries this" is something that was counted. "Carry this and you will climb" would be something invented, and the moment a page says it, every number around it turns into a claim it cannot support.',
          "The same rule holds in the other direction: when a comparison cannot be shown, the page names the count that is missing instead of filling the space with something weaker.",
        ],
      },
    },

    updated: (date: string) => `Last reviewed: ${date}.`,
  };
}
