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
import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Button, ListBox, Popover, SearchField } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";
import { countFacetOptions } from "@/shared/utils/facets";

import { COUNT_BADGE } from "./badges";
import { balanceLastLine } from "./filterPanelLines";
import { overlayPanel } from "./overlayPanel";

import type { Facet, FacetOption, FacetSelection } from "@/shared/utils/facets";
import type { Selection } from "@heroui/react";
import type { CSSProperties, RefObject } from "react";
import type { Line } from "./filterPanelLines";

/** Above this many options a cell grows a type-to-filter field; at or below it, everything is visible. */
const TYPE_TO_FILTER_THRESHOLD = 8;

/**
 * The width of the row a filter control occupies, for `FilterPanel`'s `available`.
 *
 * **Measured rather than expressed in CSS, because the panel cannot see its own column.** The dialog is
 * portalled to the document, so it has no ancestor to take a percentage or a container query from, and a
 * viewport unit counts the sidemenu's 310px as space the panel may use. The row this ref goes on is
 * inside the column, is the bar's own box on every surface, and needs no knowledge of the navigation —
 * which is what makes one expression hold with the menu expanded, collapsed, or absent entirely.
 *
 * **Attach it to the control's outermost row**, the one the trigger sits at the left edge of. The panel
 * is then exactly as wide as that row and starts where it starts.
 *
 * The state re-renders the control and nothing above it, so `AdminCrudView`'s collection-identity
 * constraint is untouched: its table is a sibling call, not a child of this subtree.
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

/**
 * The lines the panel's cells should be drawn in, measured from the cells themselves.
 *
 * **A cell's natural width does not depend on which line it lands on**, which is the whole reason this
 * is safe: the measurement is taken with growth and the width ceiling suspended, so it returns
 * `max-content` clamped by the cell's own floor whatever the current arrangement is. Re-running it
 * cannot therefore reach a different answer, and the arrangement it chooses cannot feed back into it.
 *
 * `useLayoutEffect` rather than `useEffect` so the browser never paints the packed arrangement before
 * the balanced one replaces it. It cannot run on a server render: the dialog this sits in is mounted
 * only while the popover is open.
 *
 * **Every width here is a layout box, and mixing in a client rect is the bug this reads for.** The
 * effect fires while the popover is still playing HeroUI's `zoom-in-90`, so a rect comes back scaled
 * by 0.9 while `clientWidth` beside it does not — cells then appear to need a tenth less room than the
 * line has, and a set that misses fitting by nine pixels is judged to fit.
 *
 * Returns `null` until the first measurement, which is the caller's signal to draw one wrapping row —
 * the arrangement a flex row reaches unaided, and the one this improves on.
 */
function useFilterPanelLines(shape: string, available: number | null): [RefObject<HTMLDivElement | null>, Line[] | null] {
  const ref = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<Line[] | null>(null);

  useLayoutEffect(() => {
    const column = ref.current;
    if (column === null) return;

    const cells = [...column.querySelectorAll<HTMLElement>("[data-facet-cell]")];
    const firstRow = column.firstElementChild;
    if (cells.length === 0 || firstRow === null) return;

    const gap = Number.parseFloat(getComputedStyle(firstRow).columnGap);
    const width = column.clientWidth;

    const saved = cells.map((cell) => cell.getAttribute("style"));
    for (const cell of cells) {
      cell.style.flexGrow = "0";
      cell.style.flexShrink = "0";
      cell.style.maxWidth = "none";
    }
    // `offsetWidth`, never a client rect: this runs while the popover is still playing HeroUI's
    // `zoom-in-90`, and a rect is scaled by that transform where the layout box beside it is not.
    const naturals = cells.map((cell) => cell.offsetWidth);
    for (const [index, cell] of cells.entries()) {
      const style = saved[index];
      if (style === undefined || style === null) cell.removeAttribute("style");
      else cell.setAttribute("style", style);
    }

    if (Number.isNaN(gap) || width === 0) return;
    setLines(balanceLastLine(naturals, width, gap));
  }, [shape, available]);

  return [ref, lines];
}

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
 * are exactly what does not.
 *
 * **A cell sharing its line has no ceiling at all, and does not need one** (decided 2026-08-14): its
 * neighbour is the bound, growth is shared equally, and the line fills whatever the two started at. A
 * ceiling there would be actively wrong — two cells on a wide line both reach it and come out identical,
 * which is the equal-track look this cell exists to avoid, produced from the other direction.
 *
 * **A cell alone on its line is the only one that takes a ceiling**: half a line, floored at 26rem so a
 * phone's 157px half cannot clamp content that a cap below a cell's own width would truncate rather
 * than merely limit.
 *
 * **A cell left alone on a line is answered by moving one down to join it** — `filterPanelLines.ts`
 * chooses the lines and a flex row's own packing is only what it starts from. Where that cannot help,
 * because the final pair is too wide to share a line, the short line stays short and `justify-center`
 * puts its leftover on both sides rather than all at the right. Letting it stretch instead would give
 * one cell the width of three, and a band that wide holds an option several times further from its own
 * count than every other cell in the panel does.
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
  isAlone,
  onClear,
  onSelect,
}: {
  facet: Facet<TItem>;
  counts: Record<string, number>;
  picked: readonly string[];
  /** True where this cell has its line to itself, which is the only case a ceiling is needed for. */
  isAlone: boolean;
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
    // `data-facet-cell` is how the line measurement finds these whatever it has already nested them in.
    <div
      data-facet-cell
      className={`border-border/70 flex max-h-72 w-max min-w-44 grow flex-col gap-y-1 rounded-xl border p-1.5 ${
        isAlone ? "max-w-[min(100%,max(26rem,calc((100%_-_0.75rem)/2)))]" : "max-w-full"
      }`}>
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
              <span className={`${COUNT_BADGE} bg-brand-solid text-brand-solid-foreground shrink-0`}>{count}</span>
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
 * **The panel is one 18rem column per facet, bounded by the row it hangs from** (decided 2026-08-13).
 * 18rem is the SMALLEST whole column that still lets four of them reach `--container-toolbar`, and four
 * is the public Spielsuche's own count: the surface the width was asked for on is the one that fixes the
 * column. The toolbar token is the ceiling rather than the 75rem it happens to resolve to, or a reader
 * who has enlarged their text gets a panel wider than the bar.
 *
 * **`available` is the term that keeps it inside the content column, and it cannot be a viewport unit**
 * (decided 2026-08-14). A signed-in route puts a 310px sidemenu beside `main`, so `92vw` measures 310px
 * this panel does not have; the dialog is portalled to the document, so nothing in its own ancestry knows
 * about the column either, and a container query has no container to ask. What it resolves to is a
 * ceiling wider than the space beneath its trigger, and the overlay then slides the panel LEFT until it
 * fits the window — across the navigation. The caller measures the row instead and passes its width,
 * which is the bar's own box on every surface, with the menu expanded, collapsed or absent.
 *
 * **Unset, it falls back to `100vw` and the panel behaves as it did.** That is deliberate: a caller that
 * has not adopted `useFilterPanelWidth` yet keeps today's geometry rather than collapsing to nothing.
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
 *
 * **The panel CLIPS its scroller** — `overflow-hidden` outside, the scroll inside. The rounded corners
 * are the panel's, and a rectangular scrollbar inside a rounded scroll container poked out of the curve
 * at both ends. `scrollbar-line` rather than `data-scrollbar="thin"`, because the standard thin
 * scrollbar still draws a track and, on Windows, arrow buttons.
 */
export function FilterPanel<TItem>({
  facets,
  shown = facets,
  items,
  selection,
  onSelect,
  onClear,
  available = null,
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
  /** The trigger row's own width, from `useFilterPanelWidth`. Null until measured, and on a server render. */
  available?: number | null;
}) {
  // The facet params rather than the array: `FilterLeiste` rebuilds its overflowed slice on every
  // render, and an array identity in the dependencies would re-measure on every one of them.
  const [linesRef, lines] = useFilterPanelLines(shown.map((facet) => facet.param).join("|"), available);

  return (
    <Popover.Dialog
      // One 18rem column per facet, the gap between each pair, and the panel's own padding, held under
      // the row's own width. The cast is React's type carrying no custom property, not a widening.
      style={
        {
          "--filter-columns": shown.length,
          ...(available === null ? {} : { "--filter-available": `${String(available)}px` }),
        } as CSSProperties
      }
      className={`${overlayPanel()} w-[min(92vw,var(--filter-available,100vw),calc(var(--filter-columns)*18rem_+_(var(--filter-columns)_-_1)*0.75rem_+_1.5rem),var(--container-toolbar))] overflow-hidden p-0 outline-none`}>
      <div className="scrollbar-line max-h-[70vh] overflow-x-hidden overflow-y-auto p-3">
        <div
          ref={linesRef}
          className="flex flex-col gap-3">
          {(lines ?? [shown.map((_, index) => index)]).map((line) => (
            // `flex-wrap` on a line that was chosen to fit is the safety net, not the mechanism: it is
            // what a label growing after the measurement falls back to. No `items-start`, because the
            // default cross-axis stretch is what equalises a line's cells.
            <div
              key={line.join("-")}
              className="flex flex-row flex-wrap justify-center gap-3">
              {line.map((index) => {
                const facet = shown[index];
                if (facet === undefined) return null;

                return (
                  <FacetCell
                    key={facet.param}
                    facet={facet}
                    counts={countFacetOptions(items, facets, selection, facet)}
                    picked={selection[facet.param] ?? []}
                    isAlone={line.length === 1}
                    onClear={() => {
                      onClear(facet.param);
                    }}
                    onSelect={(values) => {
                      onSelect(facet.param, values);
                    }}
                  />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Popover.Dialog>
  );
}
