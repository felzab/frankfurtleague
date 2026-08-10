import { card } from "./card";
import { ROW_ACTION_SIZE } from "./rowActionSize";
import { skeletonBlock } from "./skeleton";

/** Header cells are label-width, body cells are content-width — enough variation to read as a table. */
const HEADER_CELL_WIDTHS = ["w-28", "w-24", "w-32", "w-20"];
const BODY_CELL_WIDTHS = ["w-40", "w-36", "w-44", "w-28"];

const TABLE_ROWS = [0, 1, 2, 3, 4];
const CARD_ROWS = [0, 1, 2];
const SECTIONS = [0, 1];
const TABLE_ROW_ACTIONS = [0, 1, 2, 3];
const SECTION_ROW_ACTIONS = [0, 1];

/**
 * The targets a row ends in. How many there are decides only the cluster's width, and a resource
 * carrying fewer loses nothing by it; how tall each one is comes from `ROW_ACTION_SIZE`, which
 * `RowActions` reads too, and that is what a row is tall. A matchday offers an edit and a retire, a
 * table row up to four.
 */
function RowActionCluster({ slots, className }: { slots: readonly number[]; className: string }) {
  return (
    <div className={`flex flex-row items-center justify-end gap-2 ${className}`}>
      {slots.map((slot) => (
        <span
          key={slot}
          className={`${skeletonBlock()} ${ROW_ACTION_SIZE} rounded-xl`}
        />
      ))}
    </div>
  );
}

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
 * it; and it reserves the boxes that arrive — the filter trigger above, then whichever of the two
 * shapes below `shape` names.
 */
export function AdminCrudFallback({ shape = "table" }: { shape?: "table" | "sections" }) {
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

      {shape === "sections" ? <SectionedFallback /> : <TableFallback />}
    </div>
  );
}

/**
 * The four table-shaped resources: a stack of cards below `md`, a table above it.
 *
 * The breakpoint is the tables' own — each renders a `md:hidden` card list beside a `hidden md:block`
 * table — so a fallback holding one shape at every width reserves the wrong box on one side of it.
 */
function TableFallback() {
  return (
    <>
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
            <RowActionCluster
              slots={TABLE_ROW_ACTIONS}
              className="border-border/50 -mx-1 border-t pt-2"
            />
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
              {/* The actions cluster is what a row is as tall as: the cells' `py-4` around
                  `ROW_ACTION_SIZE`, which outgrows any text in the row by half again. */}
              <RowActionCluster
                slots={TABLE_ROW_ACTIONS}
                className="ml-auto shrink-0"
              />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The matchday list, which is the one admin resource that is not a table at any width — phase-headed
 * sections of cards, so a heading's box has to be reserved between the groups (ADR-0050).
 *
 * Its card is the real one's shape, stacked below `md` and one row above it. Reserving the `md` row
 * means the phone case is under-reserved, which is the direction that only ever settles upward.
 */
function SectionedFallback() {
  return (
    <div className="flex w-full flex-col gap-6">
      {SECTIONS.map((section) => (
        <div
          key={section}
          className="flex w-full flex-col gap-3">
          {/* The phase chip and the matchday count beside it, which is what the section's `h2` holds. */}
          <div className="flex flex-row items-center gap-x-3">
            <span className={`${skeletonBlock()} fluid-xxs block w-28 rounded-md px-1.5 py-0.5`}>&nbsp;</span>
            <span className={`${skeletonBlock()} fluid-xs block w-20 rounded`}>&nbsp;</span>
          </div>

          {CARD_ROWS.map((row) => (
            <div
              key={row}
              className={`${card()} flex w-full flex-col gap-y-3 p-4 md:flex-row md:items-center md:gap-x-4 md:gap-y-0`}>
              <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3">
                {/* The ordinal's own box. Spelled rather than read from `ROW_ACTION_SIZE`, which it
                    happens to match: it is a number in a tile, and the two are free to diverge. */}
                <span className={`${skeletonBlock()} h-10 w-10 shrink-0 rounded-xl`} />
                <div className="flex min-w-0 flex-1 flex-col gap-y-1">
                  <span className={`${skeletonBlock()} fluid-sm block w-1/2 rounded`}>&nbsp;</span>
                  <span className={`${skeletonBlock()} fluid-xs block w-1/3 rounded`}>&nbsp;</span>
                </div>
              </div>

              <span className={`${skeletonBlock()} fluid-xxs block w-24 shrink-0 rounded-md px-1.5 py-0.5`}>&nbsp;</span>

              <RowActionCluster
                slots={SECTION_ROW_ACTIONS}
                className="border-border/50 -mx-1 border-t pt-2 md:mx-0 md:shrink-0 md:border-t-0 md:pt-0"
              />
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
