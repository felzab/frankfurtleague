import { card } from "./card";
import { ROW_ACTION_SIZE } from "./rowActionSize";
import { skeletonBlock } from "./skeleton";

const TABLE_ROWS = [0, 1, 2, 3, 4];
const CARD_ROWS = [0, 1, 2];
const SECTIONS = [0, 1];
const TABLE_ROW_ACTIONS = [0, 1, 2, 3];
const SECTION_ROW_ACTIONS = [0, 1];

/** How many targets decides only the cluster's width; its height comes from `ROW_ACTION_SIZE`, which `RowActions` reads too. */
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
 * The only placeholder an admin CRUD page draws, rendered by the route, the page's fallback and the view's overlay alike.
 * **It must not call a request-dynamic hook**: a fallback that suspends pushes the bailout up and undoes the split.
 */
export function AdminCrudFallback({ shape = "table" }: { shape?: "table" | "sections" }) {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      /* `gap-4` is `AdminCrudView`'s own column gap, so both blocks sit where they will sit once the rows land. */
      className="flex flex-col gap-4">
      {/* Every admin slice declares facets, so a fallback without this row puts the list a row above the data. */}
      <div className="flex w-full flex-row items-center gap-2">
        <div className={`${skeletonBlock()} h-10 w-28 rounded-xl`} />
      </div>

      {shape === "sections" ? <SectionedFallback /> : <TableFallback />}
    </div>
  );
}

/**
 * Claims a height and refuses to claim a column layout. **Every reserved height is the shortest real one, never an**
 * **average**: reserving under grows the page, the direction the eye forgives, where reserving over shrinks it.
 */
function TableFallback() {
  return (
    <>
      <div className="flex w-full flex-col gap-3 md:hidden">
        {CARD_ROWS.map((row) => (
          <div
            key={row}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            {/* A non-breaking space inside the real type step is what gives each bar its height. */}
            <div className="flex w-full flex-row items-center gap-3">
              <span className={`${skeletonBlock()} fluid-xs block w-14 shrink-0 rounded-md px-3 py-1.5`}>&nbsp;</span>
              <span className={`${skeletonBlock()} fluid-sm block w-24 rounded`}>&nbsp;</span>
            </div>
            {/* One child at `gap-0.5`, as the real cards nest their detail lines: as two siblings they would take
                the card's own `gap-y-3` instead, and that difference is what the page moves when the rows land. */}
            <div className="flex w-full flex-col gap-0.5">
              <span className={`${skeletonBlock()} fluid-sm block w-3/4 rounded`}>&nbsp;</span>
              <span className={`${skeletonBlock()} fluid-xs block w-1/2 rounded`}>&nbsp;</span>
            </div>
            <RowActionCluster
              slots={TABLE_ROW_ACTIONS}
              className="border-border/50 -mx-1 border-t pt-2"
            />
          </div>
        ))}
      </div>

      <div className="hidden w-full md:block">
        {/* `h-fit` alone would size this to its own bars while the real table carries a minimum. */}
        <div className={`${card()} h-fit w-full overflow-hidden p-0`}>
          {/* `bg-background/90` and not `bg-muted`: `globals.css` paints `.table__column` that way with an `!`. */}
          <div className="bg-background/90 border-border flex items-center gap-6 border-b px-6 py-4">
            <span className={`${skeletonBlock()} fluid-xs block w-24 rounded`}>&nbsp;</span>
            {/* Ended right, over the `text-right` Aktionen column every table ends in. */}
            <span className={`${skeletonBlock()} fluid-xs ml-auto block w-16 rounded`}>&nbsp;</span>
          </div>

          {TABLE_ROWS.map((row) => (
            <div
              key={row}
              className="border-border/50 flex items-center gap-6 border-b px-6 py-4 last:border-b-0">
              {/* One line, so `ROW_ACTION_SIZE` stays the tallest thing in the row and the height is fixed at any width. */}
              <span className={`${skeletonBlock()} fluid-sm block w-2/5 rounded`}>&nbsp;</span>

              <span className={`${skeletonBlock()} ${ROW_ACTION_SIZE} ml-auto shrink-0 rounded-xl`} />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * The one admin resource that is not a table at any width, so a section heading's box needs reserving. How many
 * sections and cards it cannot know, and both counts err downward, which settles the page upward.
 */
function SectionedFallback() {
  return (
    <div className="flex w-full flex-col gap-6">
      {SECTIONS.map((section) => (
        <div
          key={section}
          className="flex w-full flex-col gap-3">
          <div className="flex flex-row items-center gap-x-3">
            <span className={`${skeletonBlock()} fluid-xxs block w-28 rounded-md px-1.5 py-0.5`}>&nbsp;</span>
            <span className={`${skeletonBlock()} fluid-xs block w-20 rounded`}>&nbsp;</span>
          </div>

          {CARD_ROWS.map((row) => (
            <div
              key={row}
              className={`${card()} flex w-full flex-col gap-y-3 p-4 md:flex-row md:items-center md:gap-x-4 md:gap-y-0`}>
              <div className="flex min-w-0 flex-1 flex-row items-center gap-x-3">
                {/* Spelled rather than read from `ROW_ACTION_SIZE`, which it only happens to match. */}
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

      {/* `h-10` is the real link's own declaration rather than a measurement of one. */}
      <span className={`${skeletonBlock()} h-10 w-64 rounded-xl`} />
    </div>
  );
}
