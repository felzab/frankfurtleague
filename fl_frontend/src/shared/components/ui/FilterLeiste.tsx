"use client";

import { Plus, Xmark } from "@gravity-ui/icons";

import { Button, Popover } from "@heroui/react";

import { useUrlFilters } from "@/shared/hooks/useUrlFilters";

import { COUNT_BADGE } from "./badges";
import { FilterPanel, useFilterPanelWidth } from "./FilterPanel";

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

const ADD_SHELL = `${CONTROL_BOX} text-foreground items-center gap-x-2 px-3 whitespace-nowrap`;

/**
 * The remove control's box.
 *
 * **Sized by `w-7` rather than by its own padding**, because HeroUI's `.button svg` pulls an icon 2px in
 * on each side, so content sizing would make its width a property of the icon's margins.
 */
const CLEAR_FACE = "flex h-full w-7 shrink-0 items-center justify-center rounded-none p-0";

/**
 * The ceiling on a picked value, in `em` so it holds the same number of characters at every width.
 *
 * The narrow number is what a phone row leaves once a pill's own chrome, a dimension's name and the
 * gaps are paid for; the wide one bounds the pathological case and clips no name the league holds.
 * `min-w-0` is what makes either bite — a flex item's automatic minimum is its content, and it would
 * otherwise outrank the maximum and print the value in full.
 *
 * A media query rather than a measurement: nothing here is laid out against a hidden copy of itself, so
 * the two need not agree about anything and CSS can answer on its own.
 */
const VALUE_CAP = "min-w-0 max-w-[5em] sm:max-w-[16em]";

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
 * **The pill names its dimension.** `Vergangen` alone cannot be read once the dimension has no
 * permanent trigger of its own to stand under, so the name leads and the value follows it. Above one
 * pick the badge carries how many MORE are picked, which is one rule at every count: the label is
 * always a value, the ceiling applies to all of them alike, and the badge answers one question.
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
  const spoken = `${facet.label}: ${chosen.map((option) => option.label).join(", ")} ändern`;

  return (
    <div className={PILL_SHELL}>
      <Popover>
        <Popover.Trigger
          aria-label={spoken}
          className="hover:bg-hover flex h-full cursor-pointer flex-row items-center gap-x-1.5 pr-1.5 pl-3 whitespace-nowrap transition-colors duration-(--motion-fast)">
          <span className="text-foreground-muted shrink-0">{facet.label}:</span>
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
 * The filter control as one pill per chosen dimension: the Filterleiste.
 *
 * **The row's content is a function of what was chosen and of nothing else.** No dimension is present
 * until it is filtering, nothing is promoted or demoted by width, and no hidden copy of the row is
 * measured to decide any of it. Adding a filter therefore moves nothing that was already there, and
 * using one cannot make it jump somewhere else.
 *
 * **The add control comes FIRST and is the one fixed thing in the row.** It is what an empty state is,
 * it is where a reader returns for the next dimension, and standing at the head means a pill appended
 * after it can never displace it. It offers the dimensions that are not filtering; picking any of their
 * options adds that dimension's pill.
 *
 * **The row wraps rather than scrolls** (a departure from every earlier version of this control): a
 * wrapped row shows everything it holds, a scrolled one hides part of it, and what it would hide is
 * exactly what is filtering the list. It costs a line of height on a phone with several filters, which
 * is the cheaper of the two.
 *
 * **Both popovers render `FilterPanel`** — the add control over the unfiltered dimensions, a pill over
 * its own — so this design and the panel design cannot drift into two answers for one surface.
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
  const { selection, activeCount, setFacet, clearFacet, clearAll } = useUrlFilters(facets);

  // The panel is bounded by this row rather than by the window: a viewport unit counts the sidemenu as
  // space the overlay may use, so an oversized panel gets slid left over the navigation.
  const [rowRef, rowWidth] = useFilterPanelWidth();

  if (facets.length === 0) return null;

  const isFiltering = (facet: Facet<TItem>) => (selection[facet.param] ?? []).length > 0;
  // Both halves in the facets' own declared order, so a pill's place in the row is fixed by the surface
  // rather than by when it was added, and the add menu lists dimensions in the order the page names them.
  const filtered = facets.filter(isFiltering);
  const unfiltered = facets.filter((facet) => !isFiltering(facet));

  const addFace = (
    <>
      <Plus
        aria-hidden="true"
        width={16}
        height={16}
      />
      Filter hinzufügen
    </>
  );

  return (
    <div
      ref={rowRef}
      className="flex w-full flex-col gap-2">
      <div className="flex w-full flex-row flex-wrap items-center gap-2">
        {unfiltered.length === 0 ? (
          // Kept in place rather than removed once every dimension is filtering: taking it out would
          // slide the whole row left, and the row moving is the one thing this design refuses.
          <span
            aria-disabled="true"
            className={`${ADD_SHELL} text-foreground-muted cursor-not-allowed opacity-50`}>
            {addFace}
          </span>
        ) : (
          <Popover>
            <Popover.Trigger className={`${ADD_SHELL} hover:bg-hover cursor-pointer transition-colors duration-(--motion-fast)`}>
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
        )}

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
