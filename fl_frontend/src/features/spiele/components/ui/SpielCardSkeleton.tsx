import { card } from "@/shared/components/ui/card";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

/**
 * A `SpielCard`-shaped placeholder: exact in its box model, deliberately vague in its contents.
 *
 * **Why the height can be exact** (observed, and it holds): a `SpielCard`'s height depends
 * only on the viewport, never on its data. Every text run in it is single-line by construction — the
 * team names are `truncate` inside `min-w-0` tracks, so they cannot wrap — and the two buttons are a
 * fixed 35/38px. So the height is nothing but `fluid-*` metrics plus fixed padding.
 *
 * This mirrors that box model **by reusing the same classes**, not by re-deriving sizes: the same
 * `card()` shell, the same `gap-y-6 px-4 py-3 lg:px-5 lg:py-4`, the same three rows, and text runs
 * that keep their real `fluid-*` class with a non-breaking space inside. The line box is
 * therefore computed by the same rules as the real card's, at every breakpoint, with no magic numbers
 * to drift.
 *
 * **Four shapes, deliberately** (decided 2026-08-02). A placeholder is not a wireframe: hinting at
 * every element the real card contains — both date lines, all three bars in the matchup band, two
 * chips with their icon circles — reads as clutter rather than anticipation. It should say "a card
 * is coming" and stop. So the rows keep their exact geometry while the shapes inside them stay at
 * one bar, one square, one filled band and one pill.
 *
 * **The `invisible` spans are load-bearing.** They carry no ink but they do carry the line boxes,
 * and because the visible blocks do not cover every row, they are what keeps this dimensionally
 * identical to `SpielCard`. Deleting one silently shortens the card and reintroduces the layout
 * shift this component exists to prevent.
 *
 * **Keep it in step with `SpielCard`.** If a row is added there, add its spacer here.
 */
export function SpielCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4`}>
      {/* Row 1 — the date/time stack and the two icon buttons. */}
      <div className="flex w-full flex-row items-center justify-between">
        {/* No `gap-*`: the real stack has none, and 4px here is 4px of layout shift. The two lines
            become one bar centred over them, rather than two bars stacked. */}
        <div className="relative flex flex-col">
          <span className="fluid-sm invisible font-bold">&nbsp;</span>
          <span className="fluid-xs invisible font-medium">&nbsp;</span>
          <span className={`${skeletonBlock()} fluid-sm absolute top-1/2 left-0 w-24 -translate-y-1/2 rounded-md`}>&nbsp;</span>
        </div>
        <div className="flex w-full items-center justify-end gap-x-2">
          <span className={`${skeletonBlock()} h-[35px] w-[35px] rounded-xl md:h-[38px] md:w-[38px]`} />
        </div>
      </div>

      {/* Row 2 — the matchup band, kept as one filled rectangle rather than three bars inside a tint.
          Its height comes from the score line, which is the tallest of the band's three cells in
          `SpielCard`, so a single `fluid-base` spacer reproduces it exactly. */}
      <div className={`${skeletonBlock()} flex w-full items-center rounded-xl p-2`}>
        <span className="fluid-base invisible font-extrabold">&nbsp;</span>
      </div>

      {/* Row 3 — the two status chips collapse to one pill. Dropping their `size-3.5` icons costs no
          height: the `fluid-xxs` line box is 16-19px and already out-measures the 14px icon, so
          this row is text-metric-bound either way. `w-44` is the two chips plus their gap. */}
      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        <span className={`${skeletonBlock()} rounded-lg px-1.5 py-0.5`}>
          <span className="fluid-xxs invisible block w-44 font-extrabold">&nbsp;</span>
        </span>
      </div>
    </div>
  );
}

/**
 * How many skeletons are visible at each breakpoint, so the reservation is always **two to three
 * rows** rather than a fixed six.
 *
 * The count has to be a guess — the query is capped at six but may return one — and the two ways of
 * guessing wrong are not symmetrical. Reserve too little and the extra cards appear *below* the fold,
 * pushing down content nobody is looking at. Reserve too much and the page shortens when the data
 * lands, which pulls the footer up into view: exactly the jump this skeleton exists to prevent.
 * So it deliberately under-reserves.
 *
 * It matters most on mobile, where the grid is one column and every skeleton is a full row: six of
 * them would reserve six rows for a section that might hold one match.
 */
const VISIBILITY = [
  "", // 1-3 always: one column -> 3 rows, and the page already exceeds a phone viewport
  "",
  "",
  "hidden sm:block", // 4th from two columns -> 2 rows
  "hidden lg:block", // 5th and 6th from three columns -> still 2 rows
  "hidden lg:block",
];

/** Skeletons in the same grid the real lists use, revealed per breakpoint by `VISIBILITY`. */
export function SpielCardSkeletonGrid() {
  return (
    <div
      role="status"
      aria-label="Spiele werden geladen"
      className="grid w-full grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {VISIBILITY.map((visibility, i) => (
        <div
          key={i}
          className={visibility}>
          <SpielCardSkeleton />
        </div>
      ))}
    </div>
  );
}
