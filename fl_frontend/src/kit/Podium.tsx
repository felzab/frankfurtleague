import { textOf } from "@/core/copy";
import { COPY } from "@/core/copy/shared";
import { formatOrdinal } from "@/core/format";
import { SERVER_COPY } from "@/core/serverCopy";

import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

import type { RecordText } from "@/core/copy";

/** A placed club: its name and its Kürzel, its record's own data. */
type Placed = { name: RecordText; plaque: RecordText };

/** A decided place: its club, or `null` where the place is vacant, its club having left the season by then. */
export type Place = Placed | null;

const podium = tv({
  slots: {
    // From `lg` the card it stands in is stretched to the hero's height: the steps take the spare height and place 4
    // keeps the card's foot. Below it the card is as tall as its content and has none to share.
    root: "grid lg:grid-rows-[1fr_auto]",
    steps: "grid grid-cols-3 items-end gap-2 px-4 pt-4 lg:items-stretch",
    // Read in its place's order, drawn 2 · 1 · 3: the winner in the middle, second at the left, third at the right.
    // From `lg` each place is as tall as the steps' row, and an empty first row above its plaque and name shares the
    // height they leave with its step in the steps' ratio 26 : 18 : 13, so a taller row grows every step by
    // its own share and the order of heights stays. With no spare height and names of one height, each `fr` comes to
    // 4 px, which gives the steps their heights below `lg`.
    place: "grid min-w-0 justify-items-center gap-2 text-center lg:before:content-['']",
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
    platz: {
      1: {
        place: "col-start-2 row-start-1 lg:grid-rows-[0fr_auto_26fr]",
        step: "h-26 bg-brand-solid text-on-brand lg:h-auto lg:min-h-26",
      },
      2: { place: "col-start-1 row-start-1 lg:grid-rows-[8fr_auto_18fr]", step: "h-18 bg-bg-muted text-fg lg:h-auto lg:min-h-18" },
      3: { place: "col-start-3 row-start-1 lg:grid-rows-[13fr_auto_13fr]", step: "h-13 bg-bg-muted text-fg lg:h-auto lg:min-h-13" },
    },
  },
});

/**
 * A place's plaque and name. A vacant place draws the dashed open plaque holding the dash, which already says no
 * club stands there, and its label one rung under a name, muted, so it says why without standing where a club's
 * name would; the label alone is what a screen reader reads for it.
 */
function Who({ team, nameClass }: { team: Place; nameClass: string }) {
  return team === null ? (
    <>
      <span aria-hidden>
        <TeamPlaque plaque={{ quelle: COPY.shared.noValue }} />
      </span>
      <span className="min-w-0 text-xs text-fg-muted">{SERVER_COPY.landing.saison.vacant}</span>
    </>
  ) : (
    <>
      <TeamPlaque plaque={team.plaque} />
      <span className={nameClass}>{textOf(team.name)}</span>
    </>
  );
}

/**
 * The decided season's places 1 to 3 on a three-step podium, and place 4 as a row under it; any place may be vacant.
 * It has no box of its own: it stands in the season card's body, whose box holds it, and fills the card where the
 * card's grid stretches it.
 */
export function Podium({ places }: { places: readonly [Place, Place, Place, Place] }) {
  const [first, second, third, fourth] = places;
  const slots = podium();
  return (
    <div className={slots.root()}>
      <ol className={slots.steps()}>
        {[first, second, third].map((team, index) => {
          const platz = (index + 1) as 1 | 2 | 3;
          const look = podium({ platz });
          return (
            // The list's own order tells a screen reader the place, so the step's figure is hidden from it.
            <li
              key={platz}
              className={look.place()}>
              <span className={look.who()}>
                <Who
                  team={team}
                  nameClass={look.name()}
                />
              </span>
              <span
                aria-hidden
                className={look.step()}>
                {formatOrdinal(platz)}
              </span>
            </li>
          );
        })}
      </ol>
      <p className={slots.fourth()}>
        <span className={slots.fourthPlace()}>{SERVER_COPY.landing.saison.place(4)}</span>
        <Who
          team={fourth}
          nameClass="min-w-0 font-medium"
        />
      </p>
    </div>
  );
}
