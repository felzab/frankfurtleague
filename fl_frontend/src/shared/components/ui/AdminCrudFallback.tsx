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
 * **Nothing here is ever partly transparent, and nothing it hands to ever moves.** A fade and an 8px
 * rise were each tried on this swap and each was read as a fault — as a void, because the arriving
 * column is thin text and carries far less ink than these bars until its opacity is nearly up, and
 * as the table lunging, because `--motion-ease-enter` spends 90% of its travel in the first 37%.
 * What makes the swap smooth is that every box here is measured to what arrives, so nothing moves.
 *
 * **It waits for nothing.** A route placeholder stands where the page was, so holding it back leaves
 * the reader looking at nothing at all. What survives of the old threshold is a MINIMUM on the other
 * side — `AdminCrudView` keeps this on screen to 500ms once shown — because a placeholder taken away
 * ten milliseconds after it appeared is the flicker, and one never shown is not.
 *
 * **This is the only placeholder.** The route's `loading.tsx`, the page's `Suspense` fallback and the
 * view's own overlay all render it, so the reader crosses one visible change rather than three.
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
         where they will sit once the rows land. It paints on its first frame: a delay would only help
         where the previous view stays through it, and this router unmounts the old page at once. */
      className="flex flex-col gap-4">
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
 *
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
 * **The card half keeps its shapes and takes the same height rule.** A card is allowed to be shaped
 * where a table row is not — `SpielCardSkeleton` settles that — so what mattered here was the box
 * model: three children, as four of the five real cards have, each one measured by the classes the
 * real card uses rather than by an `h-*` guess.
 *
 * Exact where it counts, vague everywhere else, and every height is built from the real classes
 * rather than from numbers, exactly as `SpielCardSkeleton` builds a card's.
 */
function TableFallback() {
  return (
    <>
      <div className="flex w-full flex-col gap-3 md:hidden">
        {CARD_ROWS.map((row) => (
          <div
            key={row}
            className={`${card()} flex w-full flex-col gap-y-3 p-4`}>
            {/* The identity row, as tall as the chip that leads it — a `fluid-xs` line box inside
                `py-1.5`, which is how three of the five spell theirs and what the other two's `h-7`
                approximates. A non-breaking space inside the real type step is what carries it. */}
            <div className="flex w-full flex-row items-center gap-3">
              <span className={`${skeletonBlock()} fluid-xs block w-14 shrink-0 rounded-md px-3 py-1.5`}>&nbsp;</span>
              <span className={`${skeletonBlock()} fluid-sm block w-24 rounded`}>&nbsp;</span>
            </div>
            {/* ONE child at `gap-0.5`, which is how every one of the five nests its detail lines —
                as two siblings they took the card's `gap-y-3` between them instead, and 10px of a
                gap the real card does not have is 10px the page moves when the rows land. */}
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
        {/* The same box the real table wears, floor included. `h-fit` alone sizes this card to its own
            bars while the table beneath carries a minimum, and any pixel between the two is a pixel
            the page moves at the handover. */}
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
              {/* One line, so `ROW_ACTION_SIZE` is the tallest thing in the row and `py-4` around it is
              what the row measures: 72px, and fixed, since neither term is fluid. A `fluid-sm` bar
              tops out at a 24px line box and cannot reach past it at any width. */}
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
 * The matchday list, which is the one admin resource that is not a table at any width — phase-headed
 * sections of cards, so a heading's box has to be reserved between the groups (ADR-0050).
 *
 * Its card carries the real card's own responsive classes rather than standing in for one of the two
 * arrangements, so it measures what arrives at both widths instead of on one side of the breakpoint.
 *
 * **It ends where the real list ends.** `AdminSpieltageList` closes on a link to the public Spielplan,
 * and that link is not conditional wherever this shape is what arrives: `saisonId` is null only when
 * the league holds no season at all, and that state returns an empty-state card instead of sections.
 * The „Ohne aktiven Spieltag“ line beside it IS conditional and is deliberately not reserved — a
 * season owing no matchday renders none, and reserving it would over-reserve the ordinary case.
 *
 * **How many sections and how many cards are the two things it cannot know**, both following from the
 * season's phases and from whatever the search and the facets left. Two sections is the smallest
 * count that still reads as sectioned rather than as one list, and three cards under each is below
 * any real phase — so the shape stays legible while the total errs downward, which is the direction
 * that settles upward rather than pulling the footer into view (`SpielCardSkeletonGrid`).
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

      {/* `h-10` is the real link's own declaration, not a measurement of one. Its `w-fit` is the
          label's width, which nothing here can reproduce and nothing vertical depends on. */}
      <span className={`${skeletonBlock()} h-10 w-64 rounded-xl`} />
    </div>
  );
}
