import { card } from "./card";
import { ROW_ACTION_SIZE } from "./rowActionSize";
import { skeletonBlock } from "./skeleton";

const TABLE_ROWS = [0, 1, 2, 3, 4];
const CARD_ROWS = [0, 1, 2];
const SECTIONS = [0, 1];
const TABLE_ROW_ACTIONS = [0, 1, 2, 3];
const SECTION_ROW_ACTIONS = [0, 1];

/**
 * The targets a card ends in, for the two shapes that stack cards rather than tabulate them. How many
 * there are decides only the cluster's width, and it is `ml-auto` or full-width in both, so a card
 * carrying either count moves no other box; how tall each one is comes from `ROW_ACTION_SIZE`, which
 * `RowActions` reads too. A matchday offers an edit and a retire.
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
 * **It is held at `opacity: 0` for `--motion-base`, then fades in over `--motion-fast`.** The delay
 * is the handover's own duration, and that is an arithmetic threshold rather than a taste: the swap
 * out of here costs a `--motion-base` cross-fade (`motion.ts :: CONTENT_FADE`), so a skeleton painted
 * for a load finishing inside that window buys the reader a wait *longer* than the one it was
 * reporting. Below the threshold it is a flicker; above it, it is a loading state.
 *
 * **`fill-mode-backwards` is what makes that a suppression rather than a pause.** Without it the
 * `from` state applies only once the animation starts, so the block would paint at full opacity for
 * the whole delay and the class would buy nothing.
 *
 * **Nothing is held back but this.** `AdminCrudShell` renders the search field and the create trigger
 * outside the boundary and the admin bar carries the route's title, so the delay hands the reader a
 * populated page with one box still filling — never the empty one a whole-page fallback would.
 *
 * The other half of the swap is `AdminCrudView`, which fades in place over the geometry this already
 * reserved and never travels, so the two do not move against each other.
 *
 * It reserves the boxes that arrive — the filter row above, then whichever of the two shapes below
 * `shape` names.
 */
export function AdminCrudFallback({ shape = "table" }: { shape?: "table" | "sections" }) {
  return (
    <div
      role="status"
      aria-label="Daten werden geladen"
      /* `gap-4` is `AdminCrudView`'s own column gap, so the filter block and the list below it sit
         where they will sit once the rows land. */
      className="animate-in fade-in fill-mode-backwards flex flex-col gap-4 delay-(--motion-base) duration-(--motion-fast) ease-(--motion-ease-enter)">
      {/* Every admin slice declares facets, so the filter control always renders its `h-10` row, and a
          fallback without it puts the list a row above the data. The row is `h-10` in both filter
          shapes; only how many controls sit in it differs, and a control's width shifts nothing
          vertically. Its reset stays unreserved — `h-7` plus `gap-2`, from the second active facet. */}
      <div className="flex w-full flex-row items-center gap-2">
        <div className={`${skeletonBlock()} h-10 w-28 rounded-xl`} />
      </div>

      {shape === "sections" ? <SectionedFallback /> : <TableFallback />}
    </div>
  );
}

/**
 * Saisons, Spieler, Schiedsrichter, Spielorte and Teams: a stack of cards below `md`, a table above
 * it.
 *
 * The breakpoint is the tables' own — each renders a `md:hidden` card list beside a `hidden md:block`
 * table — so a fallback holding one shape at every width reserves the wrong box on one side of it.
 *
 * **The table half claims a height and refuses to claim a column layout**, and the refusal is what
 * makes it match. Those five tables carry 4, 5, 5, 5 and 7 columns, at `px-6` on the outer pair and
 * `px-3` between on three of them, with widths their content decides — so any fixed set of cells here
 * is in the wrong place on most of them, which is what reads as a wireframe of a different table
 * rather than as loading. One bar per row and one block where the actions go claims only what all
 * five share: the outer padding, the header strip, the `py-4` rhythm and the row's height.
 *
 * Exact where it counts, vague everywhere else, and the height is built from the real classes rather
 * than from numbers, exactly as `SpielCardSkeleton` builds a card's.
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
