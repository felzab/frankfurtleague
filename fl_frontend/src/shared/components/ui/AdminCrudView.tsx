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
 * The data-dependent half of an admin CRUD page: the filter bar, the table slot and the modal wiring. The bar is here
 * rather than in `AdminCrudShell` because a facet's counts need the rows; the search field above the boundary does not.
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
  /** Must be a module-scope constant, for the reason `searchKeys` must be. An empty set renders no bar at all. */
  facets?: readonly Facet<TItem>[];
  /** Whether `renderTable` returns a react-aria collection, which is what has an empty first pass to cover. */
  isCollection?: boolean;
  /**
   * **Collection-identity constraint.** A re-rendering react-aria collection in a hidden Activity tree stops committing
   * rows, and this re-renders on every navigation: `React.memo` the table, and pass `items` + a render function.
   */
  renderTable: (args: { query: string; filteredItems: TItem[]; onEdit: (item: TItem) => void; onDelete: (item: TItem) => void }) => ReactNode;
  /** Optional: a resource whose form outgrew a dialog edits on a page, and its table renders a link where others wire `onEdit`. */
  renderEditModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
  /** Optional: a season is never deleted, since removing it would orphan every row carrying its id. */
  renderDeleteModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
}) {
  // The narrowing controls live above and below this component; the URL is where they meet it.
  const query = useUrlQuery();
  const selection = useFacetSelection(facets);
  const [editingItem, setEditingItem] = useState<TItem | null>(null);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const narrowedItems = useMemo(() => applyFacets(items, facets, selection), [items, facets, selection]);
  const filteredItems = useFuzzySearch({ items: narrowedItems, keys: searchKeys, query });

  return (
    // No entrance: the placeholder reserves this box exactly, so a fade or a rise animates content
    // that is not out of place. Both were tried and both read as a fault.
    <div className={`group relative flex flex-col gap-4 ${isCollection ? PLACEHOLDER_BOX : ""}`}>
      {/* Counted over the unfiltered rows, so an option answers what it would leave, not what the selection already left. */}
      <FilterLeiste
        facets={facets}
        items={items}
      />

      {renderTable({ query, filteredItems, onEdit: setEditingItem, onDelete: setDeletingItem })}

      {renderEditModal?.({ item: editingItem, isOpen: editingItem !== null, onClose: () => setEditingItem(null) })}
      {renderDeleteModal?.({ item: deletingItem, isOpen: deletingItem !== null, onClose: () => setDeletingItem(null) })}

      {/* The same placeholder the route already drew, over the whole region rather than the table alone,
          so the reader crosses one change instead of three. */}
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
