import { card } from "@/shared/components/ui/card";

/**
 * A `SpielCard`-shaped placeholder, exact rather than approximate.
 *
 * **Why it can be exact** (owner's observation, and it holds): a `SpielCard`'s height depends only on
 * the viewport, never on its data. Every text run in it is single-line by construction — the team
 * names are `truncate` inside `min-w-0` tracks, so they cannot wrap — and the two buttons are a fixed
 * 35/38px. So the height is nothing but `text-fluid-*` metrics plus fixed padding.
 *
 * This mirrors that box model **by reusing the same classes**, not by re-deriving sizes: the same
 * `card()` shell, the same `gap-y-6 px-4 py-3 lg:px-5 lg:py-4`, the same three rows, and text runs
 * that keep their real `text-fluid-*` class with a non-breaking space inside. The line box is
 * therefore computed by the same rules as the real card's, at every breakpoint, with no magic numbers
 * to drift. Six skeletons occupy exactly the space six cards will.
 *
 * **Keep it in step with `SpielCard`.** If a row is added there, add it here — the whole value of
 * this component is that the swap causes no layout shift, and that guarantee is only as good as the
 * structural match.
 */
export function SpielCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4`}>
      {/* Row 1 — date/time stack and the two icon buttons. */}
      <div className="flex w-full flex-row items-center justify-between">
        {/* No `gap-*`: the real stack has none, and 4px here is 4px of layout shift. */}
        <div className="flex flex-col">
          <span className="text-fluid-sm bg-muted inline-block w-24 animate-pulse rounded font-bold">&nbsp;</span>
          <span className="text-fluid-xs bg-muted inline-block w-16 animate-pulse rounded font-medium">&nbsp;</span>
        </div>
        <div className="flex w-full items-center justify-end gap-x-2">
          <span className="bg-muted h-[35px] w-[35px] animate-pulse rounded-xl md:h-[38px] md:w-[38px]" />
        </div>
      </div>

      {/* Row 2 — the matchup band. Same grid tracks, so the middle column sits where the score does. */}
      <div className="bg-muted grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center rounded-xl p-2">
        <span className="flex min-w-0 justify-end">
          <span className="text-fluid-xs lg:text-fluid-sm bg-foreground-muted/20 inline-block w-20 animate-pulse rounded font-bold sm:w-24">
            &nbsp;
          </span>
        </span>
        <span className="text-fluid-base bg-foreground-muted/20 mx-3 inline-block w-8 animate-pulse rounded font-extrabold lg:mx-4">
          &nbsp;
        </span>
        <span className="flex min-w-0 justify-start">
          <span className="text-fluid-xs lg:text-fluid-sm bg-foreground-muted/20 inline-block w-20 animate-pulse rounded font-bold sm:w-24">
            &nbsp;
          </span>
        </span>
      </div>

      {/* Row 3 — the two status chips. Each real chip wraps a flex row holding a `size-3.5` icon
          beside the label, and that 14px icon can out-measure the `text-fluid-xxs` line box, so the
          placeholder carries the same icon-sized block rather than assuming the text wins. */}
      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        {[20, 24].map((width) => (
          <span
            key={width}
            className="bg-muted animate-pulse rounded-lg px-1.5 py-0.5">
            <span className="text-fluid-xxs flex items-center gap-1 font-extrabold">
              <span className="bg-foreground-muted/20 size-3.5 shrink-0 rounded-full" />
              <span className={`bg-foreground-muted/20 inline-block rounded ${width === 20 ? "w-14" : "w-16"}`}>&nbsp;</span>
            </span>
          </span>
        ))}
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
