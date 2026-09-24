"use client";

import { useMemo, useState } from "react";

import { useFacetSelection } from "../../hooks/useFacetSelection";
import { useFuzzySearch } from "../../hooks/useFuzzySearch";
import { applyFacets } from "../../utils/facets";
import { AdminCrudFallback } from "./AdminCrudFallback";
import { useCrudListQuery } from "./AdminCrudPrivateQuery";
import { FilterLeiste } from "./FilterLeiste";
import { CONTENT_LAYER_CLASSES, COVER_LAYER_CLASSES, PLACEHOLDER_BOX_CLASSES } from "./placeholderBox";

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

/**
 * Read off what each stage actually left, never off the controls: a selected facet that removed nothing is not to blame.
 * Except the server's, whose removed rows never arrive: an empty read it narrowed is blamed on it.
 */
function classifyEmptiness(total: number, narrowed: number, filtered: number, readNarrowed: boolean): CrudEmptiness {
  if (narrowed === 0) return total === 0 && !readNarrowed ? "none" : "filtered";
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
  readNarrowedByRoute = false,
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
   * Whether the page narrowed the read on a term no facet draws, the change log's one record or one Vorgang. A facet's
   * own narrowing is read off the selection, so a surface passes this for nothing the bar already shows.
   */
  readNarrowedByRoute?: boolean;
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
  // The narrowing controls live above and below this component; where they meet it is the shell's.
  const query = useCrudListQuery();
  const selection = useFacetSelection(facets);
  const [deletingItem, setDeletingItem] = useState<TItem | null>(null);

  const hasFacets = facets.length > 0;

  const narrowedItems = useMemo(() => applyFacets(items, facets, selection), [items, facets, selection]);
  const filteredItems = useFuzzySearch({ items: narrowedItems, keys: searchKeys, query });
  // A default counts as picked: its pill is on the bar, and the read was narrowed to it all the same.
  const readNarrowed =
    readNarrowedByRoute || facets.some((facet) => facet.narrowsTheRead === true && (selection[facet.param] ?? []).length > 0);
  // Derived once here rather than per table: only this component sees both stages, and a table seeing one would guess.
  const emptiness = classifyEmptiness(items.length, narrowedItems.length, filteredItems.length, readNarrowed);

  return (
    // No entrance: the placeholder reserves this box exactly, so a fade or a rise animates content
    // that is not out of place. Both were tried and both read as a fault.
    <div className={PLACEHOLDER_BOX_CLASSES[shape]}>
      <div className={`${CONTENT_LAYER_CLASSES} gap-4`}>
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
      {/* Last of the two layers, and positioned: markup order decides paint only within one paint layer, and the
          rows hold positioned boxes — HeroUI's table root, every `Button` — that paint over anything left in flow. */}
      <div
        aria-hidden="true"
        className={`bg-background pointer-events-none relative opacity-(--admin-region-held) ${COVER_LAYER_CLASSES}`}>
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
