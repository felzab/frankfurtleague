import type { CalendarDay } from "@/core/format";
import type { Sponsor } from "@/kit/TileGrid";

// Content in code and not data: no database backing and no admin surface, so a change here is a deploy. The
// pages it feeds change once or twice a year.

/** What an organiser does, keyed into the catalogue's roles. */
export type OrganiserRole = "vorstand" | "spielbetrieb" | "website" | "communication";

/** The people who run the league, by their first names, in the order the landing and About show them. */
export const ORGANISERS: ReadonlyArray<{ name: string; role: OrganiserRole }> = [
  { name: "David", role: "vorstand" },
  { name: "Maria-Lucia", role: "vorstand" },
  { name: "Matin", role: "spielbetrieb" },
  { name: "Mana", role: "spielbetrieb" },
  { name: "Nick", role: "spielbetrieb" },
  { name: "Vincent", role: "spielbetrieb" },
  { name: "Felix", role: "website" },
  { name: "Jonathan", role: "communication" },
];

/**
 * The league's sponsors, each with its logo as the sponsor serves it, under `public/icons/sponsors/`, where the
 * icons' cache header covers it (`fl_frontend/next.config.ts`).
 */
const SPONSOR_ENTRIES: ReadonlyArray<{ name: string; short?: string; logo: string; href: string }> = [
  { name: "Stiftung Polytechnische Gesellschaft", short: "SPTG", logo: "/icons/sponsors/sptg.svg", href: "https://sptg.de" },
];

/** The sponsors as the kit's tiles and the footer take them, each name marked as the record's own data. */
export const SPONSORS: readonly Sponsor[] = SPONSOR_ENTRIES.map(({ name, short, ...sponsor }) => ({
  ...sponsor,
  name: { record: name },
  ...(short === undefined ? {} : { short: { record: short } }),
}));

/**
 * The day the privacy notice's words took effect: its „Stand“, and the sitemap's date for it. Hand-set,
 * since a live `new Date()` is a dynamic read, which would take the notice off the static shell.
 */
export const DATENSCHUTZ_STAND: CalendarDay = "2026-11-04";
