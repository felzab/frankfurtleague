import { COPY } from "@/core/copy";
import { formatNumber } from "@/core/format";

import { TeamPlaque } from "./TeamPlaque";
import { tv } from "./tv";

/** A placed club: its name and its Kürzel. */
export type Placed = { name: string; kuerzel: string };

const podium = tv({
  slots: {
    root: "grid gap-0 overflow-hidden rounded-lg border border-border bg-bg",
    steps: "grid grid-cols-3 items-end gap-2 px-4 pt-4",
    // Read in its place's order, drawn 2 · 1 · 3: the winner in the middle, second at the left, third at the right.
    place: "grid min-w-0 justify-items-center gap-2 text-center",
    who: "grid min-w-0 justify-items-center gap-1",
    name: "max-w-full text-sm font-semibold break-words",
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

/** The decided season's places 1 to 3 on a three-step podium, and place 4 as a row under it. */
export function Podium({ places }: { places: readonly [Placed, Placed, Placed, Placed] }) {
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
              key={club.kuerzel}
              className={look.place()}>
              <span className={look.who()}>
                <TeamPlaque kuerzel={club.kuerzel} />
                <span className={look.name()}>{club.name}</span>
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
        <span className={slots.fourthPlace()}>{COPY.landing.saison.place(4)}</span>
        <TeamPlaque kuerzel={fourth.kuerzel} />
        <span className="min-w-0 font-medium">{fourth.name}</span>
      </p>
    </div>
  );
}
