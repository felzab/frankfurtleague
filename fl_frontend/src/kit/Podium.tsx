import { formatNumber } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import { cardSurface } from "./cardStyles";
import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

/** A placed club: its name and its Kürzel. */
type Placed = { name: string; kuerzel: string };

/** A decided place: its club, or `null` where the place is vacant, its club having left the season by then (D499). */
export type Place = Placed | null;

const podium = tv({
  slots: {
    root: `grid gap-0 overflow-hidden ${cardSurface()}`,
    steps: "grid grid-cols-3 items-end gap-2 px-4 pt-4",
    // Read in its place's order, drawn 2 · 1 · 3: the winner in the middle, second at the left, third at the right.
    place: "grid min-w-0 justify-items-center gap-2 text-center",
    // The name fills its step's column rather than shrinking to its content: a centred item is as wide as its
    // longest word, so a one-word name such as „Elisabethenschule“ would run into the next column on a phone.
    // At the column's width it wraps between words, then at a hyphenation point, and only past that anywhere.
    who: "grid w-full min-w-0 justify-items-center gap-1",
    name: "w-full min-w-0 text-sm font-semibold break-words hyphens-auto",
    step: "flex w-full justify-center rounded-t-lg pt-2 font-heading text-2xl tracking-display",
    fourth: "flex items-center gap-3 border-t border-border px-4 py-3 text-sm",
    fourthPlace: "shrink-0 text-fg-muted",
  },
  variants: {
    // Board: the steps' heights, 104, 72 and 52 px, and the winner's on the band's green.
    platz: {
      1: { place: "col-start-2 row-start-1", step: "h-26 bg-brand-solid text-on-brand" },
      2: { place: "col-start-1 row-start-1", step: "h-18 bg-bg-muted text-fg" },
      3: { place: "col-start-3 row-start-1", step: "h-13 bg-bg-muted text-fg" },
    },
  },
});

/**
 * A place's plaque and name. A vacant place draws the dashed open plaque, which names nothing, and its label in the
 * name's stead, so the label is what a screen reader reads for it.
 */
function Who({ club, nameClass }: { club: Place; nameClass: string }) {
  return club === null ? (
    <>
      <TeamPlaque quelle="" />
      <span className={nameClass}>{SERVER_COPY.landing.saison.vacant}</span>
    </>
  ) : (
    <>
      <TeamPlaque kuerzel={club.kuerzel} />
      <span className={nameClass}>{club.name}</span>
    </>
  );
}

/** The decided season's places 1 to 3 on a three-step podium, and place 4 as a row under it; any place may be vacant. */
export function Podium({ places }: { places: readonly [Place, Place, Place, Place] }) {
  const [first, second, third, fourth] = places;
  const slots = podium();
  return (
    <div className={slots.root()}>
      <ol className={slots.steps()}>
        {[first, second, third].map((club, index) => {
          const platz = (index + 1) as 1 | 2 | 3;
          const look = podium({ platz });
          return (
            // The list's own order tells a screen reader the place, so the step's figure is hidden from it.
            <li
              key={platz}
              className={look.place()}>
              <span className={look.who()}>
                <Who
                  club={club}
                  nameClass={look.name()}
                />
              </span>
              <span
                aria-hidden
                className={look.step()}>
                {formatNumber(platz)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={slots.fourth()}>
        <span className={slots.fourthPlace()}>{SERVER_COPY.landing.saison.place(4)}</span>
        <Who
          club={fourth}
          nameClass="min-w-0 font-medium"
        />
      </p>
    </div>
  );
}
