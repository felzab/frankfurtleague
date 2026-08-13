import { ROW_ACTION_SIZE } from "./rowActionSize";
import { skeletonBlock } from "./skeleton";

const TABLE_ROWS = [0, 1, 2, 3, 4];

/**
 * The `md+` admin table's placeholder rows, drawn by both sides of the loading sequence.
 *
 * **Two callers, one markup, and that is the whole point.** `AdminCrudFallback` renders it while the
 * request is in flight; each admin table renders it again over its own shell for the render in which
 * react-aria's collection is still empty (`tableCollectionFloor.ts`). Drawn twice they would drift,
 * and the seam between them is exactly what the reader was seeing.
 *
 * It carries no surface of its own — a card, and whatever clips it, belong to the caller.
 *
 * **It claims a height and refuses to claim a column layout.** The five tables carry 4, 5, 5, 5 and 7
 * columns at two different interior paddings with widths their content decides, so any fixed set of
 * cells is in the wrong place on most of them. One bar per row and one block where the actions go
 * claims only what all five share: the outer padding, the header strip, the `py-4` rhythm and the
 * row's height.
 */
export function AdminTableSkeletonRows() {
  return (
    <>
      {/* `bg-background/90` and not `bg-muted`: `globals.css` paints `.table__column` that way
          with an `!`, so it is what a header strip actually is however the tables spell it. */}
      <div className="bg-background/90 border-border flex items-center gap-6 border-b px-6 py-4">
        <span className={`${skeletonBlock()} fluid-xs block w-24 rounded`}>&nbsp;</span>
        {/* Ended right, over the `text-right` Aktionen column every one of the five tables ends in. */}
        <span className={`${skeletonBlock()} fluid-xs ml-auto block w-16 rounded`}>&nbsp;</span>
      </div>

      {TABLE_ROWS.map((row) => (
        <div
          key={row}
          className="border-border/50 flex items-center gap-6 border-b px-6 py-4 last:border-b-0">
          {/* Two invisible line boxes carry the height and one bar is centred over them, the
              `SpielCardSkeleton` treatment: three of the five tables carry a `fluid-sm` over a
              `fluid-xs` at `gap-0.5`, which out-measures `ROW_ACTION_SIZE`. */}
          <div className="relative flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="fluid-sm invisible block">&nbsp;</span>
            <span className="fluid-xs invisible block">&nbsp;</span>
            <span className={`${skeletonBlock()} fluid-sm absolute top-1/2 left-0 w-2/5 -translate-y-1/2 rounded`}>&nbsp;</span>
          </div>

          <span className={`${skeletonBlock()} ${ROW_ACTION_SIZE} shrink-0 rounded-xl`} />
        </div>
      ))}
    </>
  );
}
