"use client";

import { useEffect, useRef, useState } from "react";

import { Button, ListBox, Popover, SearchField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetOption, FacetSelection } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";
import type { CSSProperties, RefObject } from "react";

/** The type-to-filter threshold and the row count `CELL_CAP` is derived from: a field appears exactly where the list stops fitting. */
const VISIBLE_OPTIONS = 5;

/**
 * A picked row's whole fill, HeroUI shipping an empty selected block. Tint off `--accent-brand-solid`, never
 * `--accent-brand`: only the solid token holds one value in both themes, the flipping one measuring 1.81:1 in dark.
 */
const OPTION_SELECTED =
  "data-[selected=true]:bg-brand-solid/20 data-[selected=true]:text-foreground data-[selected=true]:data-hovered:bg-brand-solid/30 data-[selected=true]:data-hovered:text-brand";

/** `40k + 46` for `k` = `VISIBLE_OPTIONS`: rows of 36px on 4px gaps, plus header, gap and padding. The `rem` form scales with the type. */
const CELL_CAP = "max-h-[15.375rem]";

/**
 * The trigger row's width; put the ref on the control's outermost row. Measured rather than expressed in CSS: the
 * dialog is portalled, so no ancestor can supply a percentage, and a viewport unit counts the sidemenu as space.
 */
export function useFilterPanelWidth(): [RefObject<HTMLDivElement | null>, number | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState<number | null>(null);

  useEffect(() => {
    const row = ref.current;
    if (row === null) return;

    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width;
      if (measured !== undefined) setWidth(measured);
    });
    observer.observe(row);
    return () => {
      observer.disconnect();
    };
  }, []);

  return [ref, width];
}

/** Case- and diacritic-insensitive, so „Göthe" is reached by typing „goe" as well as „gö". */
function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

/**
 * **The query is `useState` here and must not be lifted** — this renders inside `AdminCrudView`, whose
 * collection-identity constraint makes a state change above it re-render the table once per keystroke.
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

  const isWide = facet.options.length > VISIBLE_OPTIONS;
  // Counts stay over the whole option list, so a hidden option's number is already right when the query clears.
  const shown: readonly FacetOption[] =
    isWide && query !== "" ? facet.options.filter((option) => fold(option.label).includes(fold(query))) : facet.options;

  return (
    <div
      className={`border-border/70 ${CELL_CAP} flex w-max max-w-[min(100%,max(26rem,calc((100%_-_0.75rem)/2)))] min-w-44 grow flex-col gap-y-1 rounded-xl border p-1.5`}>
      {/* Fixed height and `shrink-0`: the reset appears only once something is picked and is taller than the label,
          so an intrinsic header grew on the first selection and the popover jumped while in use. */}
      <div className="flex h-6 shrink-0 flex-row items-center justify-between gap-x-2 px-1.5">
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
        // `h-8` rather than `FIELD_HEIGHT`: chrome in a capped cell, where a 40px input spends an eighth of the budget on itself.
        <SearchField
          aria-label={`${facet.label} durchsuchen`}
          value={query}
          onChange={setQuery}
          className="shrink-0 px-1.5">
          <SearchField.Group className="bg-surface border-border flex h-8 w-full items-center gap-2 rounded-lg border px-2 transition-colors duration-(--motion-fast)">
            <SearchField.SearchIcon className="text-foreground-muted size-3.5 shrink-0" />
            <SearchField.Input
              placeholder="Suchen..."
              className="fluid-xs w-full min-w-0 bg-transparent outline-none"
            />
            {/* Named for the facet: every cell is open at once, so a bare label would repeat across each wide one. */}
            <SearchField.ClearButton {...dismissControl({ label: `${facet.label}-Suche zurücksetzen` })} />
          </SearchField.Group>
        </SearchField>
      )}

      <ListBox
        aria-label={facet.label}
        selectionMode="multiple"
        // `min-h-0` lets the list absorb `CELL_CAP`: a flex item's automatic minimum is its content, so
        // without it the list refuses to shrink and the cell overflows.
        className="scrollbar-line min-h-0 overflow-x-hidden overflow-y-auto"
        selectedKeys={picked}
        renderEmptyState={() => <p className="fluid-xs text-foreground-muted px-3 py-2 font-bold italic">Keine Option gefunden</p>}
        // `"all"` is only reachable by passing `selectedKeys="all"`, which this never does — hence a map, not a cast.
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
              // A picked option stays enabled at zero, or it could not be deselected.
              isDisabled={count === 0 && !isPicked}
              // `bg-hover` is the token `globals.css`'s keyboard indicator paints, and the two must stay one colour.
              className={`${OPTION_SELECTED} fluid-sm data-hovered:bg-hover data-hovered:text-brand flex cursor-pointer flex-row items-center justify-between gap-x-3 rounded-lg px-3 py-1.5 font-bold transition-colors duration-(--motion-fast) ${
                count === 0 ? "text-foreground-muted" : "text-foreground"
              }`}>
              <span className="min-w-0 truncate">{option.label}</span>
              <span className={`${COUNT_BADGE} bg-brand-solid text-brand-solid-foreground shrink-0`}>{count}</span>
            </ListBox.Item>
          );
        })}
      </ListBox>
    </div>
  );
}

/** What the panel and its bare body both need; the geometry around the cells is not shared. */
type FilterPanelContent<TItem> = {
  /** Every dimension the surface offers; counts read against all of them, not against `shown`. */
  facets: readonly Facet<TItem>[];
  /** The subset to render. Defaults to the whole set, which is what a control with no overflow passes. */
  shown?: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
  selection: FacetSelection;
  onSelect: (param: string, values: string[]) => void;
  onClear: (param: string) => void;
};

/**
 * The scroller and its cells, for a host that brings its own dialog and width — `FilterPanel` is a `Popover.Dialog`, so a host
 * that is already one would nest a second dialog inside the first.
 */
export function FilterPanelBody<TItem>({ facets, shown = facets, items, selection, onSelect, onClear }: FilterPanelContent<TItem>) {
  return (
    <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
      {/* No `items-start`: the default cross-axis stretch equalises each line's cells, and it is per line. */}
      <div className="flex flex-row flex-wrap justify-center gap-3">
        {shown.map((facet) => (
          <FacetCell
            key={facet.param}
            facet={facet}
            counts={countFacetOptions(items, facets, selection, facet)}
            picked={selection[facet.param] ?? []}
            onClear={() => {
              onClear(facet.param);
            }}
            onSelect={(values) => {
              onSelect(facet.param, values);
            }}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * A `Popover.Dialog`, so a caller supplies the `Popover` placing it. The panel clips its scroller, a rectangular
 * scrollbar poking out of a rounded container's curve; `scrollbar-line` because the standard thin one draws a track.
 */
export function FilterPanel<TItem>({
  facets,
  shown = facets,
  items,
  selection,
  onSelect,
  onClear,
  available = null,
}: FilterPanelContent<TItem> & {
  /** The trigger row's own width, from `useFilterPanelWidth`. Null until measured, and on a server render. */
  available?: number | null;
}) {
  return (
    <Popover.Dialog
      // 18rem is the narrowest column that still lets four of them reach `--container-toolbar`, which is
      // Spielsuche's own facet count. The cast is React's type carrying no custom property, not a widening.
      style={
        {
          "--filter-columns": shown.length,
          ...(available === null ? {} : { "--filter-available": `${String(available)}px` }),
        } as CSSProperties
      }
      className={`${overlayPanel()} w-[min(92vw,var(--filter-available,100vw),calc(var(--filter-columns)*18rem_+_(var(--filter-columns)_-_1)*0.75rem_+_1.5rem),var(--container-toolbar))] overflow-hidden p-0 outline-none max-sm:w-[calc(100vw-24px)]`}>
      <FilterPanelBody
        facets={facets}
        shown={shown}
        items={items}
        selection={selection}
        onSelect={onSelect}
        onClear={onClear}
      />
    </Popover.Dialog>
  );
}
