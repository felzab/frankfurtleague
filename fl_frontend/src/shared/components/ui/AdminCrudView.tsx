"use client";

import { useState } from "react";

import { useDebouncedUrlQuery } from "../../hooks/useDebouncedUrlQuery";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { useUrlFilters } from "../../hooks/useUrlFilters";
import { applyFacets } from "../../utils/facets";
import { FilterBar } from "./FilterBar";
import { PAGE_RISE } from "./motion";

import type { ReactNode } from "react";
import type { Facet } from "../../utils/facets";

/**
 * The data-dependent half of an admin CRUD page: the filter bar, the table slot and the edit/delete
 * modal wiring. `AdminSchiedsrichterView` and `AdminSpielorteView` are per-entity declarations over it,
 * and are ~87% identical once the domain nouns are folded out.
 *
 * Generic rather than two thin siblings (decided 2026-07-30): a third admin resource would
 * otherwise be a third copy, and here it costs a `renderTable` plus up to two modal renderers — both
 * of which are optional, because a resource may edit on a page and may have nothing to delete.
 *
 * The heading, description and create trigger moved to `AdminCrudShell`, which the page
 * renders *above* the boundary this sits behind — they never depended on the resource list, so they
 * should not have waited on it. Returns its own column, which is also the animation host.
 *
 * **The filter bar is HERE and the search field is in the shell, and the split is not arbitrary.** A
 * facet's options are static per slice, but its counts are not: each one says how many rows it would
 * leave, which needs the rows. So the trigger lives below the data boundary with the table it narrows,
 * while the search field stays above it and renders immediately. The two meet in the URL like everything
 * else on these pages.
 *
 * **Filtering runs before the search.** Both orders return the same rows and this one hands Fuse the
 * smaller list.
 *
 * **Collection-identity constraint.** This component calls `useSearchParams()` via `useDebouncedUrlQuery`, so it
 * re-renders on every navigation — including while it sits in a hidden Activity tree, where a
 * react-aria collection that re-renders can stop committing rows. The table passed to `renderTable`
 * must therefore be `React.memo`'d and must use `Table.Body`'s `items` + render-function form.
 * `filteredItems` is memoised here and the two setters are `useState` setters; **do not add an
 * inline lambda or a fresh array** to the `renderTable` call. Note that `query` is inherently
 * unstable — a navigation to a route with a different `q` changes it and defeats the memo — so the
 * `items` form is the load-bearing half, not the memo. `applyFacets` returns its input unchanged when
 * nothing is selected, which is what keeps an unfiltered page's identity stable through the new stage.
 */
export function AdminCrudView<TItem extends { id: string }>({
  items,
  searchKeys,
  facets = [],
  renderTable,
  renderEditModal,
  renderDeleteModal,
}: {
  items: TItem[];
  /** Must be a module-scope constant, or `useFuzzySearch`'s memo is defeated. */
  searchKeys: readonly string[];
  /**
   * The dimensions this resource can be narrowed along. Must be a module-scope constant, for the same
   * reason `searchKeys` must be. An empty set renders no bar at all.
   */
  facets?: readonly Facet<TItem>[];
  renderTable: (args: { query: string; filteredItems: TItem[]; onEdit: (item: TItem) => void; onDelete: (item: TItem) => void }) => ReactNode;
  /**
   * Optional, because an editor is not necessarily a dialog: a resource whose form outgrew one edits
   * on a page instead (ADR-0050), and its table renders a link where the others wire `onEdit`. Teams
   * is that case; Schiedsrichter and Spielorte pass a modal.
   */
  renderEditModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
  /**
   * Optional, because not every resource can be removed: a season is never deleted and never retired —
   * one that is over is `past`, and deleting it would orphan every spiel, spieltag and junction row
   * carrying its id (ADR-0033). Saisons is that case; the other four pass one.
   */
  renderDeleteModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
}) {
  // The search FIELD is the shell's (`AdminCrudSearch`); the two meet in the URL, so this only
  // reads the debounced value.
  const { urlValue: query } = useDebouncedUrlQuery();
  const { selection } = useUrlFilters(facets);
  const [editingItem, setEditingItem] = useState<TItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const narrowedItems = applyFacets(items, facets, selection);
  const filteredItems = useFuzzySearch({ items: narrowedItems, keys: searchKeys, query });

  return (
    // Animated in on arrival, the way every other route shell is: a correctly-sized skeleton swap
    // still reads as a snap if the real content simply *appears*, so the fallback (which a warm
    // navigation never paints at all) hands over to a movement rather than to a jump.
    //
    // `gap-4` between the filter bar and the table, not the shell's `gap-8`: the bar belongs to the
    // table it narrows, and at 2rem it read as a third section of the page. The distance from the
    // search row above is still the shell's own `gap-8`, because that IS a section boundary. A slice
    // with no facets renders no bar and therefore no gap at all.
    <div className={`${PAGE_RISE} flex flex-col gap-4`}>
      {/* Counted over the UNFILTERED rows, so each option answers what it would leave rather than what
          the current selection already left. */}
      <FilterBar
        facets={facets}
        items={items}
      />

      {renderTable({ query, filteredItems, onEdit: setEditingItem, onDelete: setDeletingItem })}

      {renderEditModal?.({ item: editingItem, isOpen: editingItem !== null, onClose: () => setEditingItem(null) })}
      {renderDeleteModal?.({ item: deletingItem, isOpen: deletingItem !== null, onClose: () => setDeletingItem(null) })}
    </div>
  );
}
