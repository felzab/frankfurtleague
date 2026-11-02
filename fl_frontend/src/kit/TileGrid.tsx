import Image from "next/image";

import { cardSurface } from "./cardStyles";
import { Link } from "./Link";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { Route } from "next";

/**
 * A sponsor, a code constant with its logo file: its full name, which is its logo's accessible name and title;
 * the short name its tile and the footer's logo line show, where one is common; the logo under `/icons/sponsors/`;
 * its site.
 */
export type Sponsor = { name: string; short?: string; logo: string; href: string };

/** A club of the season: its name, its Kürzel and its page. */
type SchoolTile = { name: string; kuerzel: string; href: Route };

// One grid for both, since the season's schools and the sponsors were ruled one look, equal tiles in a
// fixed grid, four columns and two on a phone; each tile's content is its own.
const grid = tv({
  slots: {
    root: "grid grid-cols-2 gap-2 lg:grid-cols-4",
    // The tile's edge and corners hold the link, which fills under the pointer and rings inside them.
    tile: `overflow-hidden ${cardSurface()}`,
    content: "text-sm font-medium",
  },
  variants: {
    kind: {
      // Board: a school's tile, 48 px on a phone and 44 from `lg`, the plaque before the name, which breaks
      // at its own hyphens rather than being cut.
      school: { content: "flex min-h-12 items-center gap-2 px-2.5 py-1 lg:min-h-11" },
      // The logo over the short name; the logo on a white plate in both themes, so it keeps its own colours
      // on the dark one. Board: the plate's height, 64 px.
      sponsor: { content: "grid content-start gap-2 p-2 text-center" },
    },
  },
});

/**
 * The season's schools, each an equal tile leading to its club's page.
 * @awaitsPage session 3's landing
 * @awaitsProduction session 3's landing
 */
export function SchoolTiles({ schools }: { schools: readonly SchoolTile[] }) {
  const slots = grid({ kind: "school" });
  return (
    <ul className={slots.root()}>
      {schools.map((school) => (
        <li
          key={school.href}
          className={slots.tile()}>
          <Link
            href={school.href}
            placement="card">
            <span className={slots.content()}>
              <TeamPlaque kuerzel={school.kuerzel} />
              <span className="min-w-0">{school.name}</span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The sponsors, each an equal tile: its logo over its short name, the whole tile a link to its site, marked
 * `sponsored`, with no glyph saying it leaves the site. On the landing under the organisers and on the
 * sponsors' page.
 * @awaitsProduction session 3's landing and sponsors' page
 */
export function SponsorTiles({ sponsors }: { sponsors: readonly Sponsor[] }) {
  const slots = grid({ kind: "sponsor" });
  return (
    <ul className={slots.root()}>
      {sponsors.map((sponsor) => (
        <li
          key={sponsor.href}
          className={slots.tile()}>
          <Link
            href={sponsor.href}
            placement="card"
            sponsored>
            <span
              title={sponsor.name}
              className={slots.content()}>
              <span className="relative block h-16 rounded-md bg-white">
                {/* An SVG served as it is, which the image optimiser has nothing to do for, fitted into the plate. */}
                <Image
                  src={sponsor.logo}
                  alt={sponsor.name}
                  fill
                  unoptimized
                  sizes="12rem"
                  className="object-contain p-2"
                />
              </span>
              <span
                aria-hidden
                className="block truncate">
                {sponsor.short ?? sponsor.name}
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
