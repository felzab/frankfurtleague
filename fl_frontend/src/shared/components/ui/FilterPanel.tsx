"use client";

/**
 * SHARED · the filter panel, one definition for two filter controls
 *
 * The sheet a filter control opens: its width, its scroller, and one bordered cell per facet.
 * `FilterBar` renders every facet through it while `FilterLeiste` renders only the dimensions its row
 * could not promote, which is why what is shown and what the counts read against are separate props.
 *
 * Invariants:
 * - Nothing here owns state; the selection and both callbacks belong to whichever control opened it.
 * - Counts are read against every facet of the surface, never against the subset on screen.
 *
 * See:
 * - `FilterBar.tsx :: FilterBar` — the trigger, the chips, and the whole facet set
 * - `FilterLeiste.tsx :: FilterLeiste` — one trigger per dimension, and this for what overflows
 */
import { useState } from "react";

import { Button, ListBox, Popover, SearchField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetOption, FacetSelection } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";
import type { CSSProperties } from "react";

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
 * **The width STARTS from this cell's own longest option** (`w-max`), which is what CSS Grid cannot
 * express: a grid track's width is shared by every cell in it, so the sixteen-club Team facet would pad
 * out every short facet beneath it. Height is not set at all — flexbox stretches each wrapped LINE to
 * its own tallest cell, so cells match their neighbours without a two-option facet being padded to a
 * sixteen-option one's height (decided 2026-08-13).
 *
 * **From there each cell grows into its line's leftover** (`grow`, decided 2026-08-13), because a row of
 * content-width cells leaves the rest of every line empty. Flexbox hands each cell on a line the SAME
 * number of pixels, so the differences the content set survive the growth — which a grid's equal tracks
 * are exactly what does not. The 26rem cap is the one case that needs a number: a cell left alone on a
 * wrapped line would otherwise stretch across the whole panel, and an eight-character option with its
 * count a hand's width away reads as a bug. It sits above the widest cell the app produces on its own —
 * the sixteen-option Team facet, whose type-to-filter row measures 329px — so what it limits is growth.
 * A label long enough to reach it truncates, which is what a phone's narrower panel already does to one.
 *
 * **No cell is taller than `max-h-72`, and the option list is what gives way** (decided 2026-08-13).
 * The bound is on the CELL rather than on the list, so it holds whatever a cell contains: a facet
 * carrying a type-to-filter row spends 36px of the same budget and shows correspondingly fewer options,
 * instead of standing 36px taller than every facet beside it.
 *
 * **288px is where the enumerated facets end.** The longest option list any `facets.ts` spells out is
 * `STUFE_OPTIONS`' six, and six 36px rows on 4px gaps inside a 42px cell measure 286px — so every facet
 * whose options are written in source shows all of them, and only a list built from the season's own
 * documents scrolls. Those are the lists a reader expects to scroll, and past eight options they carry
 * the field that reaches the rest.
 *
 * **It is a MAXIMUM and reserves nothing.** A panel whose facets are all short is exactly as tall as its
 * tallest facet — a two-facet admin surface stands at 166px and never meets the bound at all.
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
    <div className="border-border/70 flex max-h-72 w-max max-w-[min(100%,26rem)] min-w-44 grow flex-col gap-y-1 rounded-xl border p-1.5">
      {/* A FIXED height, because the reset appears only once something is picked (decided 2026-08-08).
          Its intrinsic height exceeded the label's, so the header row grew on the first selection and
          pushed every facet below it down — the popover appeared to jump while being used.

          `shrink-0` is what makes that height survive the cell's own bound: the list below is the one
          thing meant to give way, and without it the negative space is taken from all three. */}
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
        // `h-8` rather than the shared `FIELD_HEIGHT`: this is chrome inside a popover cell, not a form
        // field, and a 40px input above a capped option list spends an eighth of the cell on itself.
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
            {/* Named for the facet, not for the panel: the cells are all open at once, so a bare
                „Suche zurücksetzen" would be one name repeated across every wide facet. */}
            <SearchField.ClearButton {...dismissControl({ label: `${facet.label}-Suche zurücksetzen` })} />
          </SearchField.Group>
        </SearchField>
      )}

      <ListBox
        aria-label={facet.label}
        selectionMode="multiple"
        // `min-h-0` is what lets the list absorb the cell's bound; a flex item's automatic minimum is
        // its content, so without it the list refuses to shrink and the cell overflows instead.
        className="scrollbar-line min-h-0 overflow-x-hidden overflow-y-auto"
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
 * The panel itself — a `Popover.Dialog`, so a caller supplies the `Popover` and the `Popover.Content`
 * that place it.
 *
 * **The panel wraps rather than columns** (decided 2026-08-13). CSS multi-column gave every cell exactly
 * one column of width whatever its content, had no common baseline, and spawned a sideways column
 * instead of scrolling when height-capped. A wrapping flex row sizes each cell from its own longest
 * option, gaps in both axes, and stretches each line's cells to that line's tallest.
 *
 * **The panel is one 18rem column per facet, held under 92vw on a phone and under the search bar it opens
 * beneath everywhere else** (decided 2026-08-13). The bar is `max-w-toolbar w-full`, so
 * `--container-toolbar` is the ceiling — the token rather than the 75rem it happens to resolve to, or a
 * reader who has enlarged their text gets a panel wider than the bar. 18rem is the SMALLEST whole column
 * that still lets four of them reach that ceiling, and four is the public Spielsuche's own count: the
 * surface the width was asked for on is the one that fixes the column.
 *
 * **The count scales the panel rather than switching it between two widths**, because the reason to hold
 * a small facet set back is proportional and a threshold is not: two facets get 612px and cannot float in
 * a metre of empty panel, three get 924px, and every count from four up meets the ceiling and wraps onto
 * a second line. Taking the smallest column that satisfies four is what keeps a cell the same ~285px on
 * every one of them, rather than making the small surfaces' cells fatter than Spielsuche's.
 *
 * **One facet needs no special case.** `shown.length` drives the column count, so a single cell opens a
 * 312px panel and `grow` fills it edge to edge, rather than a content-width box floating in a sheet
 * sized for a facet set that is not there.
 *
 * **Every count is computed with its own facet's selection removed** — see `countFacetOptions`. A number
 * beside an option answers "what would I get if I picked this too", which is the only question worth
 * answering there.
 *
 * **An option that would leave nothing is disabled rather than hidden**, the rule `GruppeSelect` already
 * follows: the reader should see why a value cannot be picked instead of wondering where it went. An
 * option that is currently selected stays enabled whatever its count, or deselecting it would be
 * impossible.
 */
export function FilterPanel<TItem>({
  facets,
  shown = facets,
  items,
  selection,
  onSelect,
  onClear,
}: {
  /**
   * Every dimension the surface offers. The counts read against all of them, so a panel showing part of
   * the set still reports what the dimensions outside it have already narrowed.
   */
  facets: readonly Facet<TItem>[];
  /** The subset to render. Defaults to the whole set, which is what a control with no overflow passes. */
  shown?: readonly Facet<TItem>[];
  /** Every row before filtering, so each option can say what it would leave. */
  items: TItem[];
  selection: FacetSelection;
  onSelect: (param: string, values: string[]) => void;
  onClear: (param: string) => void;
}) {
  return (
    /* The panel CLIPS its scroller (`overflow-hidden` outside, the scroll inside): the rounded
       corners are the panel's, and a rectangular scrollbar inside a rounded scroll container
       poked out of the curve at both ends. `scrollbar-line` rather than `data-scrollbar="thin"`,
       because the standard thin scrollbar still draws a track and, on Windows, arrow buttons. */
    <Popover.Dialog
      // One 18rem column per facet, the gap between each pair, and the panel's own padding.
      // `min()` picks the phone's 92vw or the toolbar token, so no breakpoint variant is
      // needed; the cast is React's type carrying no custom property, not a widening.
      style={{ "--filter-columns": shown.length } as CSSProperties}
      className={`${overlayPanel()} w-[min(92vw,calc(var(--filter-columns)*18rem_+_(var(--filter-columns)_-_1)*0.75rem_+_1.5rem),var(--container-toolbar))] overflow-hidden p-0 outline-none`}>
      <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
        {/* No `items-start`: the default cross-axis stretch is what equalises a line's cells, and
            it is per LINE, so a phone's one-cell line stretches to itself and needs no exception. */}
        <div className="flex flex-row flex-wrap gap-3">
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
    </Popover.Dialog>
  );
}
