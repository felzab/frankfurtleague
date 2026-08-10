import { card } from "./card";
import { skeletonBlock } from "./skeleton";

/** Header cells are label-width, body cells are content-width — enough variation to read as a table. */
const HEADER_CELL_WIDTHS = ["w-28", "w-24", "w-32", "w-20"];
const BODY_CELL_WIDTHS = ["w-40", "w-36", "w-44", "w-28"];

/**
 * The targets an admin row ends in. How many there are decides only the cluster's width, and a
 * resource carrying fewer loses nothing by it; how tall each one is `RowActions` decides, and that
 * is what a row is tall.
 */
const ROW_ACTION_SLOTS = [0, 1, 2, 3];

const TABLE_ROWS = [0, 1, 2, 3, 4];
const CARD_ROWS = [0, 1, 2];

/**
 * What an admin CRUD page shows while its rows are in flight.
 *
 * **Everything here is inert on purpose**, which is also why it needs no `"use client"`. A working-
 * looking control that swallows input is worse than no control.
 *
 * **It must not call a request-dynamic hook.** This is a `Suspense` fallback, and one that reaches
 * for `useSearchParams` suspends too — pushing the bailout up to the boundary above and undoing the
 * split that keeps the static chrome outside the data hole.
 *
 * Three things keep the hand-over from reading as a flicker: `AdminCrudView` animates in rather than
 * appearing; `delay-200 fill-mode-both` holds this at `opacity: 0` so a fast navigation never paints
 * it; and it reserves what arrives — the filter trigger, the header strip and the row rhythm, in
 * whichever shape an admin resource takes at the viewport it is read on.
 */
export function AdminCrudFallback() {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      /* `gap-4` is `AdminCrudView`'s own column gap, so the filter block and the list below it sit
         where they will sit once the rows land. */
      className="animate-in fade-in fill-mode-both flex flex-col gap-4 delay-200 duration-150">
      {/* Every admin slice declares facets, so `FilterBar` always renders its `h-10` trigger — and a
          fallback that leaves it out puts the whole list a row above where the data lands. */}
      <div className="flex w-full flex-row items-center gap-2">
        <div className={`${skeletonBlock()} h-10 w-28 rounded-xl`} />
      </div>

      {/* Below `md` an admin resource is a stack of cards rather than a table, so this changes shape
          at the same breakpoint the tables do — a table skeleton on a phone reserves the wrong box. */}
      <div className="flex w-full flex-col gap-3 md:hidden">
        {CARD_ROWS.map((row) => (
          <div
            key={row}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            <div className="flex w-full flex-row items-center gap-3">
              <span className={`${skeletonBlock()} h-7 w-14 shrink-0 rounded-md`} />
              <span className={`${skeletonBlock()} h-7 w-24 shrink-0 rounded-md`} />
            </div>
            {/* A non-breaking space inside the real type step, so a placeholder line is exactly as
                tall as the line it stands in for and follows the fluid scale on its own. */}
            <span className={`${skeletonBlock()} fluid-sm block w-3/4 rounded`}>&nbsp;</span>
            <span className={`${skeletonBlock()} fluid-xs block w-1/2 rounded`}>&nbsp;</span>
            <div className="border-border/50 -mx-1 flex flex-row items-center justify-end gap-2 border-t pt-2">
              {ROW_ACTION_SLOTS.map((slot) => (
                <span
                  key={slot}
                  className={`${skeletonBlock()} size-10 rounded-xl`}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        <div className={`${card()} h-fit w-full overflow-hidden p-0`}>
          {/* `bg-background/90` and not `bg-muted`: `globals.css` paints `.table__column` that way
              with an `!`, so it is what a header strip actually is however the tables spell it. */}
          <div className="bg-background/90 border-border flex items-center gap-6 border-b px-6 py-4">
            {HEADER_CELL_WIDTHS.map((width) => (
              <span
                key={width}
                className={`${skeletonBlock()} fluid-xs inline-block rounded ${width}`}>
                &nbsp;
              </span>
            ))}
            {/* Ended right, over the actions cluster the rows below end in. */}
            <span className={`${skeletonBlock()} fluid-xs ml-auto inline-block w-16 rounded`}>&nbsp;</span>
          </div>

          {TABLE_ROWS.map((row) => (
            <div
              key={row}
              className="border-border/50 flex items-center gap-6 border-b px-6 py-4 last:border-b-0">
              {BODY_CELL_WIDTHS.map((width) => (
                <span
                  key={width}
                  className={`${skeletonBlock()} fluid-sm inline-block rounded ${width}`}>
                  &nbsp;
                </span>
              ))}
              {/* The actions cluster is what a row is as tall as: the cells' `py-4` around a target
                  `RowActions` sizes, which outgrows any text in the row by half again. */}
              <div className="ml-auto flex shrink-0 flex-row items-center gap-2">
                {ROW_ACTION_SLOTS.map((slot) => (
                  <span
                    key={slot}
                    className={`${skeletonBlock()} size-10 rounded-xl`}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
