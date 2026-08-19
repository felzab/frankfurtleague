"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";

import { COUNT_BADGE } from "./badges";
import { FilterPanel, useFilterPanelWidth } from "./FilterPanel";
import { IconTooltip } from "./IconTooltip";

import type { Facet, FacetOption, FacetSelection } from "@/shared/utils/facets";

/** The add control and a pill share this box because they are peers in one row, not a control and state drawn beside it. */
const CONTROL_BOX = "border-border bg-surface fluid-xs flex h-10 shrink-0 flex-row rounded-xl border font-bold shadow-sm";

/** `items-stretch` so the remove control is full height; `overflow-hidden` so its fill takes the corner. */
const PILL_SHELL = `${CONTROL_BOX} items-stretch overflow-hidden`;

/** The same box holding one 16px icon: `px-3` either side makes it 40 wide, its own height. */
const ICON_SHELL = `${CONTROL_BOX} text-foreground hover:bg-hover cursor-pointer items-center gap-x-2 px-3 whitespace-nowrap transition-colors duration-(--motion-fast)`;

/** Sized by `w-7` rather than by padding: HeroUI's `.button svg` pulls an icon 2px in each side, so content sizing would
 *  make the width a property of the icon's margins. */
const CLEAR_FACE = "flex h-full w-7 shrink-0 items-center justify-center rounded-none p-0";

/**
 * The ceiling on a picked value, in `em` so it holds the same character count at every type size. `min-w-0` is what
 * makes it bite — a flex item's automatic minimum is its content, and outranks the maximum.
 */
const VALUE_CAP = "min-w-0 max-w-[7em] md:max-w-[16em]";

/** What the add control paints from `md`. Short, because the row is a row of controls. */
const ADD_LABEL = "Filter";

/** The accessible name and the tooltip both, carrying the verb the painted label drops. `IconTooltip`'s own
 *  `aria-describedby` lands on its wrapper rather than the control, so a reader is told this once. */
const ADD_HINT = "Filter hinzufügen";

/** Reset-everything: `h-7` is the app's small control, and this is the row's only one. */
const CLEAR_ALL_FACE =
  "border-border text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 rounded-lg border px-2.5 font-bold transition-colors duration-(--motion-fast)";

/**
 * In the facet's own option order rather than the click order, so one selection looks the same however it was arrived at.
 * It drops a value the options no longer offer, so a pill's count can never disagree with the value beside it.
 */
function pickedOptions<TItem>(facet: Facet<TItem>, picked: readonly string[]): FacetOption[] {
  return facet.options.filter((option) => picked.includes(option.value));
}

/**
 * One filtered dimension: the label is the first picked value alone and the badge carries how many more. The accessible
 * name carries the dimension too, a reader hearing one value alone learning nothing about what it filters.
 */
function FilterPill<TItem>({
  facet,
  facets,
  items,
  selection,
  available,
  onSelect,
  onClear,
}: {
  facet: Facet<TItem>;
  facets: readonly Facet<TItem>[];
  items: TItem[];
  selection: FacetSelection;
  available: number | null;
  onSelect: (param: string, values: string[]) => void;
  onClear: (param: string) => void;
}) {
  const chosen = pickedOptions(facet, selection[facet.param] ?? []);

  return (
    <div className={PILL_SHELL}>
      <Popover>
        {/* `pr-0.5` because the control beside it centres its glyph in a wider box, so this reads as the pill's own gap. */}
        <Popover.Trigger
          aria-label={`${facet.label}: ${chosen.map((option) => option.label).join(", ")} ändern`}
          className="hover:bg-hover flex h-full cursor-pointer flex-row items-center gap-x-2 pr-0.5 pl-3 whitespace-nowrap transition-colors duration-(--motion-fast)">
          <span className={`text-brand truncate ${VALUE_CAP}`}>{chosen[0]?.label ?? ""}</span>
          {chosen.length > 1 && (
            <span className={`${COUNT_BADGE} bg-brand-solid text-brand-solid-foreground shrink-0`}>+{chosen.length - 1}</span>
          )}
        </Popover.Trigger>
        <Popover.Content
          placement="bottom start"
          offset={8}>
          {/* `facets` is the whole set and `shown` this one dimension: counts must read against every dimension, or
              they ignore what the other pills already narrowed. */}
          <FilterPanel
            facets={facets}
            shown={[facet]}
            available={available}
            items={items}
            selection={selection}
            onSelect={onSelect}
            onClear={onClear}
          />
        </Popover.Content>
      </Popover>

      <Button
        variant="ghost"
        aria-label={`Filter ${facet.label} entfernen`}
        onPress={() => {
          onClear(facet.param);
        }}
        className={`${CLEAR_FACE} text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong min-w-0 cursor-pointer transition-colors duration-(--motion-fast)`}>
        <Xmark
          aria-hidden="true"
          className="size-3.5 shrink-0"
        />
      </Button>
    </div>
  );
}

/**
 * The empty gate is this component rather than a branch inside `FilterRow`: the Rules of Hooks put a return above a
 * hook call out of reach, and the row's two URL subscriptions must stay off an unfilterable surface.
 */
export function FilterLeiste<TItem>({
  facets,
  items,
}: {
  /** Must be a module-scope constant, for the reason `AdminCrudView`'s `searchKeys` must be. */
  facets: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
}) {
  if (facets.length === 0) return null;

  return (
    <FilterRow
      facets={facets}
      items={items}
    />
  );
}

/**
 * The row's content is a function of what was chosen and of nothing else: no dimension is present until it is filtering,
 * nothing is promoted or demoted by width, and nothing hidden is measured. Adding a filter moves nothing already there.
 */
function FilterRow<TItem>({ facets, items }: { facets: readonly Facet<TItem>[]; items: TItem[] }) {
  const { selection, paramOrder, activeCount, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  // The panel is bounded by this row rather than by the window; `useFilterPanelWidth` carries why.
  const [rowRef, rowWidth] = useFilterPanelWidth();

  const isFiltering = (facet: Facet<TItem>) => (selection[facet.param] ?? []).length > 0;
  // Pills in the URL's order, so a new one lands at the end and no pill already drawn moves. A filtering
  // facet is in the URL by construction, so neither `indexOf` can be -1.
  const filtered = facets.filter(isFiltering).sort((left, right) => paramOrder.indexOf(left.param) - paramOrder.indexOf(right.param));
  const unfiltered = facets.filter((facet) => !isFiltering(facet));

  // `md` rather than `lg`: the sidemenu is a drawer until `lg`, so the row is wider there than at `lg` itself.
  const addFace = (
    <>
      <Sliders
        aria-hidden="true"
        width={16}
        height={16}
      />
      <span className="max-md:hidden">{ADD_LABEL}</span>
    </>
  );

  return (
    <div
      ref={rowRef}
      className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-row items-center gap-2">
        {/* Outside the scroller and first, so the add control is never scrolled out of reach and an appended pill
            displaces nothing. */}
        {unfiltered.length === 0 ? (
          // Kept in place once every dimension is filtering: removing it would slide the whole row left.
          <span
            aria-disabled="true"
            aria-label={ADD_HINT}
            className={`${ICON_SHELL} text-foreground-muted cursor-not-allowed opacity-50`}>
            {addFace}
          </span>
        ) : (
          <IconTooltip label={ADD_HINT}>
            <Popover>
              <Popover.Trigger
                aria-label={ADD_HINT}
                className={ICON_SHELL}>
                {addFace}
              </Popover.Trigger>
              <Popover.Content
                placement="bottom start"
                offset={8}>
                <FilterPanel
                  facets={facets}
                  shown={unfiltered}
                  available={rowWidth}
                  items={items}
                  selection={selection}
                  onSelect={setFacet}
                  onClear={clearFacet}
                />
              </Popover.Content>
            </Popover>
          </IconTooltip>
        )}

        {/* The shadow is the scroll affordance here: a scrollbar under a row this short would cost a quarter of it. */}
        {filtered.length > 0 && (
          <ScrollShadow
            orientation="horizontal"
            size={24}
            hideScrollBar
            className="min-w-0 flex-1">
            <div className="flex flex-row items-center gap-2">
              {filtered.map((facet) => (
                <FilterPill
                  key={facet.param}
                  facet={facet}
                  facets={facets}
                  items={items}
                  selection={selection}
                  available={rowWidth}
                  onSelect={setFacet}
                  onClear={clearFacet}
                />
              ))}
            </div>
          </ScrollShadow>
        )}
      </div>

      {activeCount > 1 && (
        <Button
          variant="ghost"
          onPress={clearAll}
          className={`${CLEAR_ALL_FACE} self-start`}>
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
