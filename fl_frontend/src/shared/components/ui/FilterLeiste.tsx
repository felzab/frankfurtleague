"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, Popover, ScrollShadow } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";

import { COUNT_BADGE } from "./badges";
import { FilterPanel, useFilterPanelWidth } from "./FilterPanel";
import { IconTooltip } from "./IconTooltip";

import type { Facet, FacetOption, FacetSelection } from "@/shared/utils/facets";

/**
 * What every control in this row is: the app's `h-10` box — a border, the surface fill, `shadow-sm` and
 * `rounded-xl`, the recipe the back buttons and the Spieltage control carry.
 *
 * The add control and a pill are the same box, because they are peers in one row rather than a control
 * and a piece of state drawn beside it.
 */
const CONTROL_BOX = "border-border bg-surface fluid-xs flex h-10 shrink-0 flex-row rounded-xl border font-bold shadow-sm";

/** `items-stretch` so the remove control is full height; `overflow-hidden` so its fill takes the corner. */
const PILL_SHELL = `${CONTROL_BOX} items-stretch overflow-hidden`;

/** The same box holding one 16px icon: `px-3` either side makes it 40 wide, its own height. */
const ICON_SHELL = `${CONTROL_BOX} text-foreground hover:bg-hover cursor-pointer items-center gap-x-2 px-3 whitespace-nowrap transition-colors duration-(--motion-fast)`;

/**
 * The remove control's box.
 *
 * **Sized by `w-7` rather than by its own padding**, because HeroUI's `.button svg` pulls an icon 2px in
 * on each side, so content sizing would make its width a property of the icon's margins.
 */
const CLEAR_FACE = "flex h-full w-7 shrink-0 items-center justify-center rounded-none p-0";

/**
 * The ceiling on a picked value — one number at every width, in `em` so it holds the same count of
 * characters whatever the type resolves to.
 *
 * **Twelve characters on a phone, measured on a name rather than on the row.** `Carlo-Mierendorff`
 * reaching `Carlo-Miere…` is the target; that string plus the ellipsis measures about 7em at this
 * weight. Below the breakpoint it truncates venues before the word that tells them apart —
 * `Sportanlage Riederwald` and `Bezirkssportanlage Nord` both lose their last word — which is the cost
 * of a 343px row, paid where that row exists.
 *
 * **From `md` it clips nothing the league holds.** 16em clears the longest name by more than 3em, so
 * the ceiling there bounds a pathological value and touches no real one. Two arms rather than one
 * because they answer different questions — a phone clips because its row is 343px, and a desktop has
 * no such number — and it is the label's own breakpoint rather than a third in this file.
 *
 * `min-w-0` is what makes it bite — a flex item's automatic minimum is its content, and it would
 * otherwise outrank the maximum and print the value in full.
 */
const VALUE_CAP = "min-w-0 max-w-[7em] md:max-w-[16em]";

/** What the add control paints from `md`. Short, because the row is a row of controls. */
const ADD_LABEL = "Filter";

/**
 * What it is CALLED — the accessible name and the tooltip, carrying the verb the painted label drops.
 *
 * The two cannot collide: the name is this string on the trigger's `aria-label`, and `IconTooltip`'s
 * own `aria-describedby` lands on its `role="presentation"` wrapper rather than on the control, so a
 * reader is told this once and the painted word is not announced at all.
 */
const ADD_HINT = "Filter hinzufügen";

/** Reset-everything: `h-7` is the app's small control, and this is the row's only one. */
const CLEAR_ALL_FACE =
  "border-border text-foreground-muted data-hovered:bg-hover-danger data-hovered:text-danger-strong fluid-xxs flex h-7 shrink-0 cursor-pointer flex-row items-center gap-x-1.5 rounded-lg border px-2.5 font-bold transition-colors duration-(--motion-fast)";

/**
 * What is picked, in the FACET's own option order rather than the order it was clicked in.
 *
 * The pill names the first of these, so reading from the facet is what makes one selection look the
 * same however it was arrived at — and it drops a value the options no longer offer, so the count on
 * the pill can never disagree with the value beside it.
 */
function pickedOptions<TItem>(facet: Facet<TItem>, picked: readonly string[]): FacetOption[] {
  return facet.options.filter((option) => picked.includes(option.value));
}

/**
 * One filtered dimension, as one pill.
 *
 * **A pill exists because a dimension is filtering, and for no other reason** — nothing here is
 * promoted, demoted or measured, so the row's content is a function of what was chosen and of nothing
 * else. That is what keeps a filter from moving the moment it is used.
 *
 * **The pill shows the value alone.** Above one pick the badge carries how many MORE are picked, so the
 * label means one thing at every count and the ceiling applies to all of them alike.
 *
 * **The accessible name carries the dimension whatever the visible label does**, because a reader
 * hearing „Vergangen" alone learns nothing about what it filters. It is not the same decision.
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
        {/* `pr-0.5` because the visible gap is not this padding alone: the control beside it centres a
            14px glyph in a 28px box, so 2px here reads as 9px — the 8px the pill already puts between
            its own parts, plus one. The button keeps its 28px target whatever this is. */}
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
          {/* `facets` is the whole set and `shown` is this one dimension: the counts have to read
              against every dimension of the surface, or the numbers ignore what the other pills
              already narrowed. */}
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
 * The app's filter control: one pill per filtered dimension, and one control that adds another.
 *
 * **The row's content is a function of what was chosen and of nothing else.** No dimension is present
 * until it is filtering, nothing is promoted or demoted by width, and no hidden copy of the row is
 * measured to decide any of it. Adding a filter moves nothing that was already there, and using one
 * cannot make it jump somewhere else.
 *
 * **The add control stands outside the scroller and first**, so the control that adds a filter can
 * never be the thing scrolled out of reach, and a pill appended after it displaces nothing.
 *
 * **Pills sit in the order the URL holds them**, which is the order they were added — `useUrlFilters`
 * carries why that needs no second home. The add menu keeps the facets' declared order, which is the
 * surface's own vocabulary rather than a history.
 *
 * **Every options surface is `FilterPanel`** — the add control over the dimensions that are not
 * filtering, a pill over its own — so no two of them can drift into different answers.
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
  const { selection, paramOrder, activeCount, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  // The panel is bounded by this row rather than by the window: a viewport unit counts the sidemenu as
  // space the overlay may use, so an oversized panel gets slid left over the navigation.
  const [rowRef, rowWidth] = useFilterPanelWidth();

  if (facets.length === 0) return null;

  const isFiltering = (facet: Facet<TItem>) => (selection[facet.param] ?? []).length > 0;
  // Pills in the URL's order, which is the order they were added: a new one lands at the end and no
  // pill already drawn moves. A filtering facet is in the URL by construction, so neither `indexOf`
  // can be -1. The menu keeps the declared order.
  const filtered = facets.filter(isFiltering).sort((left, right) => paramOrder.indexOf(left.param) - paramOrder.indexOf(right.param));
  const unfiltered = facets.filter((facet) => !isFiltering(facet));

  // `md` rather than `lg`: the 310px sidemenu is a drawer until `lg`, so the row is 704px there against
  // 635 at `lg`. The label is in the markup and hidden by CSS, so the name is the `aria-label` either way.
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
        {/* Outside the scroller, and that is the point: the control that adds a filter may never be the
            thing scrolled out of reach. It is also first, so a pill appended after it displaces nothing. */}
        {unfiltered.length === 0 ? (
          // Kept in place rather than removed once every dimension is filtering: taking it out would
          // slide the whole row left, and the row moving is the one thing this design refuses.
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

        {/* 24px of shadow on a 40px strip: the shadow IS the affordance at this height, where a
            scrollbar under the row would cost a quarter of it. */}
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
