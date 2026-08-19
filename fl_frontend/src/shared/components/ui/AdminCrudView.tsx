"use client";

import { useMemo, useState } from "react";

import { useFacetSelection } from "../../hooks/useFacetSelection";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { useUrlQuery } from "../../hooks/useUrlQuery";
import { applyFacets } from "../../utils/facets";
import { AdminCrudFallback } from "./AdminCrudFallback";
import { FilterLeiste } from "./FilterLeiste";
import { PLACEHOLDER_BOX } from "./placeholderBox";

import type { ReactNode } from "react";
import type { Facet } from "../../utils/facets";

/** A stable stand-in for a resource with no facets: a fresh `[]` default would miss every memo below. */
const NO_FACETS: readonly never[] = [];

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
 * **Collection-identity constraint.** This component calls `useSearchParams()` — via `useUrlQuery` and
 * `useFacetSelection` — so it re-renders on every navigation, including while it sits in a hidden
 * Activity tree, where a react-aria collection that re-renders can stop committing rows. The table
 * passed to `renderTable` must therefore be `React.memo`'d and must use `Table.Body`'s `items` +
 * render-function form.
 * `narrowedItems` and `filteredItems` are both memoised here and the two setters are `useState`
 * setters; **do not add an inline lambda or a fresh array** to the `renderTable` call. Note that
 * `query` is inherently unstable — a navigation to a route with a different `q` changes it and
 * defeats the memo — so the `items` form is the load-bearing half, not the memo.
 *
 * **A selected facet is the case that early return does not cover.** `applyFacets` returns its input unchanged
 * only while nothing is selected; past that it filters, so the memo below is what holds the identity —
 * and it holds only because `readFacetSelection` returns one object per query string. `facets` must be
 * a module-scope constant or a `useMemo`'d build for the same reason, which is why the empty default
 * is a constant rather than a literal.
 */
export function AdminCrudView<TItem extends { id: string }>({
  items,
  searchKeys,
  facets = NO_FACETS,
  isCollection = true,
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
  /**
   * Whether `renderTable` returns a react-aria collection, which is what has an empty first pass to
   * cover. False for the matchday list, whose sections are mapped markup and render complete at once.
   */
  isCollection?: boolean;
  renderTable: (args: { query: string; filteredItems: TItem[]; onEdit: (item: TItem) => void; onDelete: (item: TItem) => void }) => ReactNode;
  /**
   * Optional, because an editor is not necessarily a dialog: a resource whose form outgrew one edits
   * on a page instead (ADR-0040), and its table renders a link where the others wire `onEdit`. Teams
   * and Spieler are those cases; the resources with dialog editors pass a modal.
   */
  renderEditModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
  /**
   * Optional, because not every resource can be removed: a season is never deleted and never retired —
   * one that is over is `past`, and deleting it would orphan every spiel, spieltag and junction row
   * carrying its id (ADR-0026). Saisons is that case; every other resource passes one.
   */
  renderDeleteModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
}) {
  // Every control that narrows this list is elsewhere — the field in the shell's `AdminCrudSearch`,
  // the facets in the bar below — and they meet it in the URL, so this side only reads.
  const query = useUrlQuery();
  const selection = useFacetSelection(facets);
  const [editingItem, setEditingItem] = useState<TItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const narrowedItems = useMemo(() => applyFacets(items, facets, selection), [items, facets, selection]);
  const filteredItems = useFuzzySearch({ items: narrowedItems, keys: searchKeys, query });

  return (
    // NO entrance: the placeholder reserves this box exactly, so the swap has nothing to reconcile.
    // A fade and an 8px rise were each tried and each read worse — see `AdminCrudFallback`'s header.
    <div className={`group relative flex flex-col gap-4 ${isCollection ? PLACEHOLDER_BOX : ""}`}>
      {/* Counted over the UNFILTERED rows, so each option answers what it would leave rather than what
          the current selection already left. */}
      <FilterLeiste
        facets={facets}
        items={items}
      />

      {renderTable({ query, filteredItems, onEdit: setEditingItem, onDelete: setDeletingItem })}

      {renderEditModal?.({ item: editingItem, isOpen: editingItem !== null, onClose: () => setEditingItem(null) })}
      {renderDeleteModal?.({ item: deletingItem, isOpen: deletingItem !== null, onClose: () => setDeletingItem(null) })}

      {/* The SAME placeholder the route and the boundary already drew, over this whole region rather
          than over the table alone — so the filter bar and the card below it are the placeholder's,
          not a half-real composition, and the reader crosses one change instead of three. */}
      {isCollection && (
        <div
          aria-hidden="true"
          className="bg-background pointer-events-none absolute inset-0 group-has-[tbody]:opacity-(--admin-placeholder-hold)">
          <AdminCrudFallback />
        </div>
      )}
    </div>
  );
}
