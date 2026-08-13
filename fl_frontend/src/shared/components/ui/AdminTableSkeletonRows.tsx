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
 * claims only what all five share: the outer padding, the header strip and the `py-4` rhythm.
 *
 * **Both heights are the SHORTEST real one, not an average, because the two errors are not
 * equivalent.** Reserving under what arrives grows the page, which is the direction the eye forgives;
 * reserving over it shrinks the page, and a reversal is what gets noticed. So a row is `py-4` around
 * `ROW_ACTION_SIZE` — **72px**, the shortest row on any of the five (Spieler's) — and the header is
 * `px-6 py-4` around a `fluid-xs` line, **53px at 1280**, the shortest header. Measured 2026-08-13,
 * every other real row running from 83 to 163.
 *
 * **A single skeleton cannot match all five and is not trying to.** Spielorte alone runs 99 to 143
 * *within one table*, because a two-line address is taller than a one-line one and none of that
 * exists yet when this renders. The two taller headers are the same effect: a column label that wraps.
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
          {/* One line, so `ROW_ACTION_SIZE` is the tallest thing in the row and `py-4` around it is
              what the row measures: 72px, and fixed, since neither term is fluid. A `fluid-sm` bar
              tops out at a 24px line box and cannot reach past it at any width. */}
          <span className={`${skeletonBlock()} fluid-sm block w-2/5 rounded`}>&nbsp;</span>

          <span className={`${skeletonBlock()} ${ROW_ACTION_SIZE} ml-auto shrink-0 rounded-xl`} />
        </div>
      ))}
    </>
  );
}
