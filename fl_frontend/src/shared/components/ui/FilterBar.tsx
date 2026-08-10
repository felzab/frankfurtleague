"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { overlayPanel } from "./overlayPanel";

import type { Facet } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";

/**
 * The filter control: one trigger, a popover of multi-selects, and the active choices as removable chips.
 *
 * **A popover rather than a row of dropdowns or a wall of chips** (decided 2026-08-07). Spielsuche wants
 * seven dimensions and Saisons wants two, so the control has to scale across an order of magnitude: a
 * dropdown per facet wraps badly past three and hides which values are excluded, and every option
 * rendered inline is a wall on the big surfaces. One trigger scales; the chips underneath are what keep
 * the current state visible, which is the thing a closed popover would otherwise cost.
 *
 * **Every count is computed with its own facet's selection removed** — see `countFacetOptions`. A number
 * beside an option answers "what would I get if I picked this too", which is the only question worth
 * answering there.
 *
 * **An option that would leave nothing is disabled rather than hidden**, the rule `GruppeSelect` already
 * follows: the reader should see why a value cannot be picked instead of wondering where it went. An
 * option that is currently selected stays enabled whatever its count, or deselecting it would be
 * impossible.
 *
 * **The state is the URL's and nothing here holds any** — `useUrlFilters` carries the reasoning, and the
 * short version is that filtering must not cost a server round trip on a page that already holds all its
 * rows.
 */
export function FilterBar<TItem>({
  facets,
  items,
  triggerLabel = "Filter",
}: {
  /** Must be a module-scope constant, for the reason `AdminCrudView`'s `searchKeys` must be. */
  facets: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
  triggerLabel?: string;
}) {
  const { selection, activeCount, toggle, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  if (facets.length === 0) return null;

  // One chip per selected value, flattened across facets, in the facets' own order so the strip does not
  // reorder itself as choices are made.
  const chips = facets.flatMap((facet) =>
    (selection[facet.param] ?? []).map((value) => ({
      facet,
      value,
      label: facet.options.find((option) => option.value === value)?.label ?? value,
    })),
  );

  return (
    // A column of two rows rather than one wrapping row (decided 2026-08-08): wrapping pushes the
    // list down the page by a row of chips per overflow, while scrolling them sideways keeps the
    // control one row tall whatever is selected.
    <div className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-row items-center gap-2">
        <Popover>
          <Popover.Trigger
            aria-label={activeCount === 0 ? triggerLabel : `${triggerLabel}, ${String(activeCount)} aktiv`}
            className="border-border bg-surface text-foreground hover:bg-muted fluid-xs flex h-10 shrink-0 cursor-pointer flex-row items-center gap-x-2 rounded-xl border px-3 font-bold shadow-sm transition-colors">
            <Sliders
              aria-hidden="true"
              width={16}
              height={16}
            />
            {triggerLabel}
            {activeCount > 0 && <span className={`${COUNT_BADGE} bg-brand/50 text-foreground`}>{activeCount}</span>}
          </Popover.Trigger>

          <Popover.Content
            placement="bottom start"
            offset={8}>
            {/* MASONRY columns, not a grid (decided 2026-08-08). A grid aligns cells into rows, so one tall
              facet stretched its whole row and left holes under its shorter neighbours — the "chaotic"
              read. CSS multi-column is what filter panels actually use for this: each facet keeps its
              own height, the columns fill top to bottom with no gaps, and `break-inside-avoid` keeps a
              facet from being sliced across two columns.

              The widths track the SEARCH BAR's own. The bar is `max-w-toolbar w-full` (1200px), so the
              panel is `92vw` on a phone — the bar's own width there — and grows toward the toolbar cap
              on a desktop, never narrower than the control it opens under. A page with few facets gets
              the narrow form, or two facets would float in a metre of empty panel.

              The panel CLIPS its scroller (`overflow-hidden` outside, the scroll inside): the rounded
              corners are the panel's, and a rectangular scrollbar inside a rounded scroll container
              poked out of the curve at both ends. `scrollbar-line` rather than `data-scrollbar="thin"`,
              because the standard thin scrollbar still draws a track and, on Windows, arrow buttons. */}
            <Popover.Dialog
              className={`${overlayPanel()} w-[92vw] overflow-hidden p-0 outline-none ${
                facets.length >= 5 ? "sm:w-[min(92vw,44rem)] lg:w-[min(92vw,64rem)] xl:w-[min(92vw,75rem)]" : "sm:w-[min(92vw,40rem)]"
              }`}>
              {/* The SCROLLER and the COLUMNS are two elements, and merging them is the bug this
                  split fixes (decided 2026-08-08): a height-capped multicol container does not scroll
                  its overflow, it spawns ANOTHER column sideways — on a phone, `columns-1` plus
                  `max-h` produced a second column off the right edge. Unconstrained, the columns
                  balance to the content's own height and the scroller above them only scrolls down.
                  On a phone that leaves a single unconstrained column: a plain vertical stack. */}
              <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
                <div
                  className={`gap-x-3 ${facets.length >= 5 ? "columns-1 sm:columns-2 lg:columns-3 xl:columns-4" : "columns-1 sm:columns-2"}`}>
                  {facets.map((facet) => {
                    const counts = countFacetOptions(items, facets, selection, facet);
                    const picked = selection[facet.param] ?? [];

                    // A facet with many options still flows its OPTIONS in two columns (decided
                    // 2026-08-08), so the Team facet is nine rows rather than seventeen — the cell itself
                    // stays one masonry column wide, and the column layout absorbs whatever height remains.
                    const isWide = facet.options.length > 8;

                    return (
                      <div
                        key={facet.param}
                        // `break-inside-avoid` is what multi-column layout is bought for: without it a
                        // facet is sliced mid-option across two columns. `mb-3` rather than the parent's
                        // gap, because multicol has no row-gap — the bottom margin is the vertical rhythm.
                        className="border-border/70 mb-3 flex w-full min-w-0 break-inside-avoid flex-col gap-y-1 rounded-xl border p-1.5 last:mb-0">
                        {/* A FIXED height, because the reset appears only once something is picked (decided
                        2026-08-08). Its intrinsic height exceeded the label's, so the header row grew on the
                        first selection and pushed every facet below it down — the popover appeared to jump
                        while being used. Reserving the row lets the button come and go without reflow. */}
                        <div className="flex h-6 flex-row items-center justify-between gap-x-2 px-1.5">
                          <span className="fluid-xxs text-foreground-muted font-bold tracking-widest uppercase">{facet.label}</span>
                          {picked.length > 0 && (
                            <Button
                              variant="ghost"
                              aria-label={`${facet.label} zurücksetzen`}
                              onPress={() => clearFacet(facet.param)}
                              className="fluid-xxs text-foreground-muted hover:text-foreground h-full shrink-0 cursor-pointer leading-none font-bold transition-colors">
                              Zurücksetzen
                            </Button>
                          )}
                        </div>

                        <ListBox
                          aria-label={facet.label}
                          selectionMode="multiple"
                          className={isWide ? "sm:grid sm:grid-cols-2 sm:gap-x-1" : undefined}
                          selectedKeys={picked}
                          // `Selection` is `"all" | Set<Key>`; `"all"` is only reachable by passing
                          // `selectedKeys="all"`, which this never does, so it maps to an empty selection
                          // rather than to a cast.
                          onSelectionChange={(keys: Selection) => {
                            setFacet(facet.param, keys === "all" ? [] : [...keys].map(String));
                          }}>
                          {facet.options.map((option) => {
                            const count = counts[option.value] ?? 0;
                            const isPicked = picked.includes(option.value);

                            return (
                              <ListBox.Item
                                key={option.value}
                                id={option.value}
                                textValue={option.label}
                                // A selected option stays enabled whatever its count — disabling it would make
                                // it impossible to deselect, which is the one state this rule must not create.
                                isDisabled={count === 0 && !isPicked}
                                // The value carries the emphasis and its count carries the brand
                                // (decided 2026-08-08): full-strength text for an option that would
                                // match something, muted for one that would match nothing.
                                className={`fluid-sm hover:bg-muted hover:text-brand flex cursor-pointer flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-2 font-bold transition-colors ${
                                  count === 0 ? "text-foreground-muted" : "text-foreground"
                                }`}>
                                <span className="min-w-0 truncate">{option.label}</span>
                                <span className={`${COUNT_BADGE} bg-brand/50 text-foreground shrink-0`}>{count}</span>
                              </ListBox.Item>
                            );
                          })}
                        </ListBox>
                      </div>
                    );
                  })}
                </div>
              </div>
            </Popover.Dialog>
          </Popover.Content>
        </Popover>

        {/* The chips are what make a closed popover honest: they say what is narrowing the list, and each
            one removes exactly itself. Beside the trigger and scrolling sideways, so the control stays one
            row tall however many are active (decided 2026-08-08).

            `ScrollShadow` at 16px rather than its 40px default: this is a 28px-tall strip, and a shadow the
            height of the content reads as a gradient over the chips rather than as an edge. `hideScrollBar`
            because the shadow IS the affordance here — a horizontal bar under a 28px row costs a third of it.

            **The facet name is gone from the chip and kept in the `aria-label`** (decided 2026-08-08). On a
            phone the name doubled every chip's width for information the values mostly carry themselves —
            „Viertelfinale“ does not need „Phase:“ in front of it. A screen reader still hears which filter
            it is, so the saving is visual only. */}
        {chips.length > 0 && (
          <ScrollShadow
            orientation="horizontal"
            // 24 rather than the 16 this shipped at (decided 2026-08-08): on a phone the shadow IS the
            // only sign the strip scrolls, and at 16px over 28px-tall chips it read as anti-aliasing.
            size={24}
            hideScrollBar
            className="min-w-0 flex-1">
            <div className="flex flex-row items-center gap-2">
              {chips.map(({ facet, value, label }) => (
                // Value, a straight divider, then the x (decided 2026-08-08). The divider is its own
                // element rather than a border on the button: HeroUI's Button brings a radius and its
                // own box, so a `border-l` there renders kinked and the x rides off-centre.
                <span
                  key={`${facet.param}:${value}`}
                  // `h-10`, the trigger's own height (decided 2026-08-08): the chips and the button sit
                  // in one row, and two heights in one row read as two controls that happen to touch.
                  className="border-brand/25 bg-brand/10 flex h-10 shrink-0 flex-row items-stretch overflow-hidden rounded-xl border">
                  <span className="fluid-xs text-foreground flex items-center px-2.5 font-bold whitespace-nowrap">{label}</span>
                  <span
                    aria-hidden="true"
                    className="bg-brand/25 w-px shrink-0"
                  />
                  <Button
                    variant="ghost"
                    aria-label={`Filter ${facet.label}: ${label} entfernen`}
                    // `toggle`, not a filtered `setFacet`: it reads the live selection itself, so removing
                    // two chips quickly cannot have the second rebuild from a snapshot taken before the first.
                    onPress={() => toggle(facet.param, value)}
                    className="text-foreground-muted hover:bg-danger/15 hover:text-danger-strong flex h-full w-8 min-w-0 shrink-0 cursor-pointer items-center justify-center rounded-none p-0 transition-colors">
                    <Xmark
                      aria-hidden="true"
                      className="size-3.5 shrink-0"
                    />
                  </Button>
                </span>
              ))}
            </div>
          </ScrollShadow>
        )}
      </div>

      {/* Below the strip rather than at the end of it, where it scrolled out of reach exactly when the most
          filters were active and it was most wanted. `self-start` so it takes its own width. */}
      {activeCount > 1 && (
        <Button
          variant="ghost"
          onPress={clearAll}
          className="border-border text-foreground-muted hover:border-danger/40 hover:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 self-start rounded-lg border px-2.5 font-bold transition-colors">
          <Xmark
            aria-hidden="true"
            className="size-3.5 shrink-0"
          />
          Alle Filter zurücksetzen
        </Button>
      )}
    </div>
  );
}
