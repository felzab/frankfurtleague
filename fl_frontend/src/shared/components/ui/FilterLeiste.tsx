"use client";

import { Sliders, Xmark } from "@gravity-ui/icons";

import { Button, Drawer, Popover } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { useUrlFilters } from "@/shared/hooks/useUrlFilters";

import { COUNT_BADGE } from "./badges";
import { FilterPanel, FilterPanelBody, useFilterPanelWidth } from "./FilterPanel";
import { IconTooltip } from "./IconTooltip";
import { overlayPanel } from "./overlayPanel";

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
 * The ceiling on a picked value, in `em` so it holds the same number of characters at every width.
 *
 * `min-w-0` is what makes it bite — a flex item's automatic minimum is its content, and it would
 * otherwise outrank the maximum and print the value in full. A media query rather than a measurement:
 * nothing here is laid out against a hidden copy of itself, so CSS can answer on its own.
 */
const VALUE_CAP = "min-w-0 max-w-[5em] sm:max-w-[16em]";

/** What the add control is called, in both its label and its tooltip. */
const ADD_LABEL = "Filter hinzufügen";

/** The word this control already goes by — `FilterBar`'s own default trigger label. */
const FILTER_LABEL = "Filter";

/** Reset-everything, one recipe for the row's own and the sheet's: `h-7` is the app's small control. */
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
 * **The pill names its dimension, then its value.** A value identifies its own dimension only where a
 * surface has one, and these have up to seven: `Kein Ort` reads as a venue beside `Sportplatz Ost`,
 * `Lessing` is a club, a referee and a venue in a league of schools named after people, and `A` or `E1`
 * says nothing at all. Above one pick the badge carries how many MORE are picked, so the label means one
 * thing at every count.
 *
 * **The accessible name carries the dimension whatever the visible label does**, because a reader
 * hearing „Vergangen" alone learns nothing about what it filters.
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
        <Popover.Trigger
          aria-label={`${facet.label}: ${chosen.map((option) => option.label).join(", ")} ändern`}
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
 * The filter control: a row of pills on a screen with room for one, a single control and a sheet below
 * that.
 *
 * **The row's content is a function of what was chosen and of nothing else.** No dimension is present
 * until it is filtering, nothing is promoted or demoted by width, and no hidden copy of the row is
 * measured to decide any of it. Adding a filter moves nothing that was already there, and using one
 * cannot make it jump somewhere else.
 *
 * **Below `sm` the row is REPLACED rather than shrunk.** A phone has room for a filter surface or for
 * the list it filters, not both, so the whole row collapses to one control carrying a count and a sheet
 * holding every dimension at once. Shrinking the row instead is what the previous two rounds tried, and
 * each answer cost something real — a clipped club name, or a dimension hidden behind an overflow.
 *
 * **The split is CSS, not a measurement.** Both surfaces are in the tree and `sm` decides which one is
 * displayed, so there is no hydration guess, no flash, and one breakpoint spelling shared with every
 * other responsive rule in the app. Neither surface holds state, so mounting both costs a box each.
 *
 * **The sheet applies as it is touched and has no Apply button.** Every filter in this app is URL state
 * that takes effect at once; a surface that batched its changes would be the only one that did.
 *
 * **Both surfaces render `FilterPanel`** — the add control over the unfiltered dimensions, a pill over
 * its own, the sheet over all of them — so no two of them can drift into different answers.
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

  const filterIcon = (
    <Sliders
      aria-hidden="true"
      width={16}
      height={16}
    />
  );

  return (
    <div
      ref={rowRef}
      className="w-full">
      {/* The phone's whole filter surface: one control, and a sheet holding every dimension. */}
      <div className="sm:hidden">
        <Drawer>
          <Drawer.Trigger
            aria-label={activeCount === 0 ? ADD_LABEL : `Filter, ${String(activeCount)} aktiv`}
            className={ICON_SHELL}>
            {filterIcon}
            {activeCount > 0 && <span className={`${COUNT_BADGE} bg-brand-solid text-brand-solid-foreground shrink-0`}>{activeCount}</span>}
          </Drawer.Trigger>
          <Drawer.Backdrop>
            {/* `overlayPanel()` is the surface every panel in this app wears, `FilterPanel` included, so
                the sheet and the panel it holds are one object. `rounded-b-none` is the one departure:
                the recipe's lower corners would round against the viewport's own edge. */}
            <Drawer.Content
              placement="bottom"
              className={`${overlayPanel()} rounded-b-none`}>
              <Drawer.Dialog
                aria-label={FILTER_LABEL}
                className="flex flex-col outline-none">
                {/* `p-3` is the body's own inset below it, so the heading and the cells share one
                    margin. The rule is `border-border`, the one the app draws every separator in. */}
                <div className="border-border flex shrink-0 flex-row items-center gap-2 border-b p-3">
                  <span className="fluid-lg text-foreground font-extrabold tracking-tight">{FILTER_LABEL}</span>
                  {activeCount > 0 && (
                    <Button
                      variant="ghost"
                      onPress={clearAll}
                      className={CLEAR_ALL_FACE}>
                      <Xmark
                        aria-hidden="true"
                        className="size-3.5 shrink-0"
                      />
                      Alle Filter zurücksetzen
                    </Button>
                  )}
                  <Drawer.CloseTrigger {...dismissControl({ label: "Filter schließen", className: "ml-auto" })} />
                </div>

                <FilterPanelBody
                  facets={facets}
                  shown={facets}
                  items={items}
                  selection={selection}
                  onSelect={setFacet}
                  onClear={clearFacet}
                />
              </Drawer.Dialog>
            </Drawer.Content>
          </Drawer.Backdrop>
        </Drawer>
      </div>

      {/* The row, from `sm` up. */}
      <div className="flex w-full flex-col gap-2 max-sm:hidden">
        <div className="flex w-full flex-row flex-wrap items-center gap-2">
          {unfiltered.length === 0 ? (
            // Kept in place rather than removed once every dimension is filtering: taking it out would
            // slide the whole row left, and the row moving is the one thing this design refuses.
            <span
              aria-disabled="true"
              aria-label={ADD_LABEL}
              className={`${ICON_SHELL} text-foreground-muted cursor-not-allowed opacity-50`}>
              {filterIcon}
            </span>
          ) : (
            <IconTooltip label={ADD_LABEL}>
              <Popover>
                <Popover.Trigger
                  aria-label={ADD_LABEL}
                  className={ICON_SHELL}>
                  {filterIcon}
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
            className={`${CLEAR_ALL_FACE} self-start`}>
            <Xmark
              aria-hidden="true"
              className="size-3.5 shrink-0"
            />
            Alle Filter zurücksetzen
          </Button>
        )}
      </div>
    </div>
  );
}
