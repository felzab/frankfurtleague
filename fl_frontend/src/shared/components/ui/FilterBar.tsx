"use client";

import { useState } from "react";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, ListBox, Popover, ScrollShadow, SearchField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { useUrlFilters } from "@/shared/hooks/useUrlFilters";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetOption } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";

/** Above this many options a cell grows a type-to-filter field; at or below it, everything is visible. */
const TYPE_TO_FILTER_THRESHOLD = 8;

/** Case- and diacritic-insensitive, so „Göthe" is reached by typing „goe" as well as „gö". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * One facet's box inside the panel: its heading, its reset, and its options.
 *
 * **The query is `useState` HERE and must not be lifted.** `FilterBar` renders inside `AdminCrudView`,
 * whose collection-identity constraint means a state change above this component re-renders the table
 * once per keystroke. Local state costs nothing above the cell.
 *
 * **The width comes from this cell's own longest option** (`w-max`), which is what CSS Grid cannot
 * express: a grid track's width is shared by every cell in it, so the sixteen-club Team facet would pad
 * out every short facet beneath it. Height is not set at all — flexbox stretches each wrapped LINE to
 * its own tallest cell, so cells match their neighbours without a two-option facet being padded to a
 * sixteen-option one's height (decided 2026-08-13).
 *
 * **The option list is capped and scrolls internally.** Without a cap one long facet would set the
 * height of its whole line; with one, the tallest cell on a line is eight rows and the type-to-filter
 * field is how the rest is reached.
 */
function FacetCell<TItem>({
  facet,
  counts,
  picked,
  onClear,
  onSelect,
}: {
  facet: Facet<TItem>;
  counts: Record<string, number>;
  picked: readonly string[];
  onClear: () => void;
  onSelect: (values: string[]) => void;
}) {
  const [query, setQuery] = useState("");

  const isWide = facet.options.length > TYPE_TO_FILTER_THRESHOLD;
  // Counts stay computed over the WHOLE option list, so a hidden option's number is already correct
  // when the query is cleared.
  const shown: readonly FacetOption[] =
    isWide && query !== "" ? facet.options.filter((option) => fold(option.label).includes(fold(query))) : facet.options;

  return (
    <div className="border-border/70 flex w-max max-w-full min-w-44 flex-col gap-y-1 rounded-xl border p-1.5">
      {/* A FIXED height, because the reset appears only once something is picked (decided 2026-08-08).
          Its intrinsic height exceeded the label's, so the header row grew on the first selection and
          pushed every facet below it down — the popover appeared to jump while being used. */}
      <div className="flex h-6 flex-row items-center justify-between gap-x-2 px-1.5">
        <span className="fluid-xxs text-foreground-muted font-bold tracking-widest uppercase">{facet.label}</span>
        {picked.length > 0 && (
          <Button
            variant="ghost"
            aria-label={`${facet.label} zurücksetzen`}
            onPress={onClear}
            className="fluid-xxs text-foreground-muted data-hovered:text-foreground h-full shrink-0 cursor-pointer leading-none font-bold transition-colors duration-(--motion-fast)">
            Zurücksetzen
          </Button>
        )}
      </div>

      {isWide && (
        // `h-8` rather than the shared `FIELD_HEIGHT`: this is chrome inside a popover cell, not a form
        // field, and a 40px input above a capped option list spends an eighth of the cell on itself.
        <SearchField
          aria-label={`${facet.label} durchsuchen`}
          value={query}
          onChange={setQuery}
          className="px-1.5">
          <SearchField.Group className="bg-surface border-border flex h-8 w-full items-center gap-2 rounded-lg border px-2 transition-colors duration-(--motion-fast)">
            <SearchField.SearchIcon className="text-foreground-muted size-3.5 shrink-0" />
            <SearchField.Input
              placeholder="Suchen..."
              className="fluid-xs w-full min-w-0 bg-transparent outline-none"
            />
            {/* Named for the facet, not for the panel: the cells are all open at once, so a bare
                „Suche zurücksetzen" would be one name repeated across every wide facet. */}
            <SearchField.ClearButton {...dismissControl({ label: `${facet.label}-Suche zurücksetzen` })} />
          </SearchField.Group>
        </SearchField>
      )}

      <ListBox
        aria-label={facet.label}
        selectionMode="multiple"
        // The cap is the cell's, not the panel's: the panel already scrolls at `70vh`, and a cell that
        // scrolls on its own is what keeps one long facet from setting its whole line's height.
        className="scrollbar-line max-h-72 overflow-x-hidden overflow-y-auto"
        selectedKeys={picked}
        renderEmptyState={() => <p className="fluid-xs text-foreground-muted px-3 py-2 font-bold italic">Keine Option gefunden</p>}
        // `Selection` is `"all" | Set<Key>`; `"all"` is only reachable by passing `selectedKeys="all"`,
        // which this never does, so it maps to an empty selection rather than to a cast.
        onSelectionChange={(keys: Selection) => {
          onSelect(keys === "all" ? [] : [...keys].map(String));
        }}>
        {shown.map((option) => {
          const count = counts[option.value] ?? 0;
          const isPicked = picked.includes(option.value);

          return (
            <ListBox.Item
              key={option.value}
              id={option.value}
              textValue={option.label}
              // A selected option stays enabled whatever its count — disabling it would make it
              // impossible to deselect, which is the one state this rule must not create.
              isDisabled={count === 0 && !isPicked}
              // `bg-hover` is the token the keyboard indicator in `globals.css` paints too, and the two
              // being one colour is that rule's whole claim. The brand ink is the call site's own pair.
              className={`fluid-sm data-hovered:bg-hover data-hovered:text-brand flex cursor-pointer flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-1.5 font-bold transition-colors duration-(--motion-fast) ${
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
}

/**
 * The filter control: one trigger, a popover of multi-selects, and the active choices as removable chips.
 *
 * **A popover rather than a row of dropdowns or a wall of chips** (decided 2026-08-07). Spielsuche wants
 * seven dimensions and Saisons wants two, so the control has to scale across an order of magnitude: a
 * dropdown per facet wraps badly past three and hides which values are excluded, and every option
 * rendered inline is a wall on the big surfaces. One trigger scales; the chips underneath are what keep
 * the current state visible, which is the thing a closed popover would otherwise cost.
 *
 * **The panel wraps rather than columns** (decided 2026-08-13). CSS multi-column gave every cell exactly
 * one column of width whatever its content, had no common baseline, and spawned a sideways column
 * instead of scrolling when height-capped. A wrapping flex row sizes each cell from its own longest
 * option, gaps in both axes, and stretches each line's cells to that line's tallest.
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
            {/* The widths track the SEARCH BAR's own. The bar is `max-w-toolbar w-full` (1200px), so the
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
              <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
                {/* No `items-start`: the default cross-axis stretch is what equalises a line's cells, and
                    it is per LINE, so a phone's one-cell line stretches to itself and needs no exception. */}
                <div className="flex flex-row flex-wrap gap-3">
                  {facets.map((facet) => (
                    <FacetCell
                      key={facet.param}
                      facet={facet}
                      counts={countFacetOptions(items, facets, selection, facet)}
                      picked={selection[facet.param] ?? []}
                      onClear={() => {
                        clearFacet(facet.param);
                      }}
                      onSelect={(values) => {
                        setFacet(facet.param, values);
                      }}
                    />
                  ))}
                </div>
              </div>
            </Popover.Dialog>
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
