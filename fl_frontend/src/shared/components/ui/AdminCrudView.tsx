"use client";

import { useMemo, useState } from "react";

import { useFacetSelection } from "../../hooks/useFacetSelection";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { useUrlQuery } from "../../hooks/useUrlQuery";
import { applyFacets } from "../../utils/facets";
import { AdminCrudFallback } from "./AdminCrudFallback";
import { FilterLeiste } from "./FilterLeiste";
import { CONTENT_LAYER, COVER_LAYER, PLACEHOLDER_BOX } from "./placeholderBox";

import type { ReactNode } from "react";
import type { Facet, FacetCounts } from "../../utils/facets";
import type { Leserichtung } from "../../utils/leserichtung";
import type { AdminCrudShape } from "./AdminCrudFallback";

/** A stable stand-in for a resource with no facets: a fresh `[]` default would miss every memo below. */
const NO_FACETS: readonly never[] = [];

/**
 * Which narrowing stage emptied the list, so an empty state can name it. Facets narrow before the search, so a filter
 * that left nothing owns the message even where a query is typed too. `"none"` covers an untouched resource as well.
 */
export type CrudEmptiness = "none" | "filtered" | "searched";

/** Read off what each stage actually left, never off the controls: a selected facet that removed nothing is not to blame. */
function classifyEmptiness(total: number, narrowed: number, filtered: number): CrudEmptiness {
  if (narrowed === 0) return total === 0 ? "none" : "filtered";
  return filtered === 0 ? "searched" : "none";
}

/**
 * The data-dependent half of an admin CRUD page: the filter bar, the table slot and the modal wiring. The bar is here
 * rather than in `AdminCrudShell` because a facet's counts need the rows; the search field above the boundary does not.
 */
export function AdminCrudView<TItem extends { id: string }>({
  items,
  searchKeys,
  facets = NO_FACETS,
  facetCounts,
  leserichtung,
  shape = "table",
  renderTable,
  renderDeleteModal,
}: {
  items: TItem[];
  /** Must be a module-scope constant, or `useFuzzySearch`'s memo is defeated. */
  searchKeys: readonly string[];
  /** Must be a module-scope constant, for the reason `searchKeys` must be. An empty set renders no bar at all. */
  facets?: readonly Facet<TItem>[];
  /**
   * What a `narrowsTheRead` facet's options count, which `items` cannot answer: the page fetched only what that
   * facet selects, so every other option would count zero against the rows on hand and be offered as unreachable.
   */
  facetCounts?: FacetCounts;
  /**
   * The direction the page fetched under, for a list served from one end of a capped read. Undefined on every other
   * surface, which then draws no read-order control; a surface passing one needs facets, the control riding in the bar.
   */
  leserichtung?: Leserichtung;
  /**
   * Which placeholder this region holds, and — `"table"` alone being a react-aria collection —
   * whether the release waits for rows a later pass commits.
   */
  shape?: AdminCrudShape;
  /**
   * **Collection-identity constraint.** A re-rendering react-aria collection in a hidden Activity tree stops committing
   * rows, and this re-renders on every navigation: `React.memo` the table, and pass `items` + a render function.
   */
  renderTable: (args: {
    filteredItems: TItem[];
    /** Which stage left the table with nothing, for an empty state to name. */
    emptiness: CrudEmptiness;
    onDelete: (item: TItem) => void;
  }) => ReactNode;
  /** Optional: a season is never deleted, since removing it would orphan every row carrying its id. */
  renderDeleteModal?: (args: { item: TItem | null; isOpen: boolean; onClose: () => void }) => ReactNode;
}) {
  // The narrowing controls live above and below this component; the URL is where they meet it.
  const query = useUrlQuery();
  const selection = useFacetSelection(facets);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const hasFacets = facets.length > 0;

  const narrowedItems = useMemo(() => applyFacets(items, facets, selection), [items, facets, selection]);
  const filteredItems = useFuzzySearch({ items: narrowedItems, keys: searchKeys, query });
  // Derived once here rather than per table: only this component sees both stages, and a table seeing one would guess.
  const emptiness = classifyEmptiness(items.length, narrowedItems.length, filteredItems.length);

  return (
    // No entrance: the placeholder reserves this box exactly, so a fade or a rise animates content
    // that is not out of place. Both were tried and both read as a fault.
    <div className={PLACEHOLDER_BOX[shape]}>
      <div className={`${CONTENT_LAYER} gap-4`}>
        {/* Counted over the unfiltered rows, so an option answers what it would leave, not what the selection already left. */}
        <FilterLeiste
          facets={facets}
          items={items}
          facetCounts={facetCounts}
          leserichtung={leserichtung}
        />

        {renderTable({ filteredItems, emptiness, onDelete: setDeletingItem })}

        {renderDeleteModal?.({ item: deletingItem, isOpen: deletingItem !== null, onClose: () => setDeletingItem(null) })}
      </div>

      {/* The same placeholder the route already drew, over the whole region rather than the table alone,
          so the reader crosses one change instead of three. */}
      {/* Last of the two layers: the markup orders what a cell paints, so a cover written first sits under the rows. */}
      <div
        aria-hidden="true"
        className={`bg-background pointer-events-none opacity-(--admin-region-held) ${COVER_LAYER}`}>
        {/* The cover must draw what THIS resource's route drew: a second shape here, or a bar over a
            facet-less page, is the boundary crossing the whole cover exists to hide. */}
        <AdminCrudFallback
          shape={shape}
          hasFacets={hasFacets}
        />
      </div>
    </div>
  );
}
