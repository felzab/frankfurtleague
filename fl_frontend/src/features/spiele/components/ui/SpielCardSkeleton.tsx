import { card } from "@/shared/components/ui/card";
import { skeletonBlock } from "@/shared/components/ui/skeleton";

/**
 * **The `invisible` spans are load-bearing**, carrying line boxes the visible blocks do not, so
 * deleting one brings back the shift this exists to prevent. Sizes are `SpielCard`'s own classes,
 * never re-derived, and must stay in step with it.
 */
function SpielCardSkeleton() {
  return (
    <div
      aria-hidden="true"
      className={`${card()} relative flex h-auto w-full flex-col items-center justify-between gap-x-4 gap-y-6 px-4 py-3 lg:px-5 lg:py-4`}>
      <div className="flex w-full flex-row items-center justify-between">
        {/* No `gap-*`: the real stack has none, and a gap here is that much layout shift. */}
        <div className="relative flex flex-col">
          <span className="fluid-sm invisible font-bold">&nbsp;</span>
          <span className="fluid-xs invisible font-medium">&nbsp;</span>
          <span className={`${skeletonBlock()} fluid-sm absolute top-1/2 left-0 w-24 -translate-y-1/2 rounded-md`}>&nbsp;</span>
        </div>
        <div className="flex w-full items-center justify-end gap-x-2">
          <span className={`${skeletonBlock()} h-[35px] w-[35px] rounded-xl md:h-[38px] md:w-[38px]`} />
        </div>
      </div>

      {/* One filled rectangle, not three bars in a tint. Its height comes from the score line, the
          tallest of the band's cells, so one `fluid-base` spacer reproduces it. */}
      <div className={`${skeletonBlock()} flex w-full items-center rounded-xl p-2`}>
        <span className="fluid-base invisible font-extrabold">&nbsp;</span>
      </div>

      {/* The two chips collapse to one pill. Dropping their icons costs no height: the `fluid-xxs`
          line box already out-measures them, so the row is text-metric-bound either way. */}
      <div className="flex h-fit w-full flex-row items-center justify-center gap-x-2">
        <span className={`${skeletonBlock()} rounded-lg px-1.5 py-0.5`}>
          <span className="fluid-xxs invisible block w-44 font-extrabold">&nbsp;</span>
        </span>
      </div>
    </div>
  );
}

/**
 * **Deliberately under-reserves**: too little pushes down content below the fold, while too much
 * shortens the page when data lands and pulls the footer up — the jump this exists to prevent.
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
