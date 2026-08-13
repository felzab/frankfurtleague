"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";

import { COUNT_BADGE } from "./badges";
import { FilterPanel } from "./FilterPanel";

import type { Facet } from "@/shared/utils/facets";

/**
 * The filter control: one trigger, a popover of multi-selects, and the active choices as removable chips.
 *
 * **A popover rather than a row of dropdowns or a wall of chips** (decided 2026-08-07). Spielsuche wants
 * seven dimensions and Saisons wants two, so the control has to scale across an order of magnitude: a
 * dropdown per facet wraps badly past three and hides which values are excluded, and every option
 * rendered inline is a wall on the big surfaces. One trigger scales; the chips underneath are what keep
 * the current state visible, which is the thing a closed popover would otherwise cost.
 *
 * **The sheet itself is `FilterPanel`**, which `FilterLeiste` opens too — its width, its cells and its
 * counts are that component's, and this passes the whole facet set because this control promotes none.
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
            className="border-border bg-surface text-foreground hover:bg-hover fluid-xs flex h-10 shrink-0 cursor-pointer flex-row items-center gap-x-2 rounded-xl border px-3 font-bold shadow-sm transition-colors duration-(--motion-fast)">
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
            <FilterPanel
              facets={facets}
              items={items}
              selection={selection}
              onSelect={setFacet}
              onClear={clearFacet}
            />
          </Popover.Content>
        </Popover>

        {/* The chips are what make a closed popover honest: they say what is narrowing the list, and each
            one removes exactly itself. Beside the trigger and scrolling sideways, so the control stays one
            row tall however many are active (decided 2026-08-08).

            `ScrollShadow` at 24px on a 40px-tall strip: the shadow IS the affordance here, because a
            horizontal scrollbar under the row costs a quarter of it.

            **The facet name is gone from the chip and kept in the `aria-label`** (decided 2026-08-08). On a
            phone the name doubled every chip's width for information the values mostly carry themselves —
            „Viertelfinale" does not need „Phase:" in front of it. A screen reader still hears which filter
            it is, so the saving is visual only. */}
        {chips.length > 0 && (
          <ScrollShadow
            orientation="horizontal"
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
                  // The fill alone draws the boundary; a border beside it draws the same edge twice.
                  className="bg-brand/10 flex h-10 shrink-0 flex-row items-stretch overflow-hidden rounded-xl">
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
                    onPress={() => {
                      toggle(facet.param, value);
                    }}
                    // `w-7` is 28x40, above WCAG 2.2 SC 2.5.8's 24x24 floor and four pixels lighter than
                    // the `w-8` it replaces.
                    className="text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong flex h-full w-7 min-w-0 shrink-0 cursor-pointer items-center justify-center rounded-none p-0 transition-colors duration-(--motion-fast)">
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
          className="border-border text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 self-start rounded-lg border px-2.5 font-bold transition-colors duration-(--motion-fast)">
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
