"use client";

/**
 * SHARED · the filter A/B switch — SCAFFOLDING
 *
 * Two filter controls are in the tree at once so the two can be compared as working software on any
 * surface without a rebuild, and this picks between them from the URL.
 *
 * **Delete this file, its parameter and the losing component in the commit that adopts a winner**, and
 * point `AdminCrudView` and `SpielsucheView` straight at the survivor. Nothing else imports either
 * component, so that commit is a rename and two deletions.
 *
 * See:
 * - `FilterBar.tsx :: FilterBar` — the panel, reworked
 * - `FilterLeiste.tsx :: FilterLeiste` — one trigger per dimension
 */
import { useSearchParams } from "next/navigation";

import { FilterBar } from "./FilterBar";
import { FilterLeiste } from "./FilterLeiste";

import type { Facet } from "@/shared/utils/facets";

/** Absent or anything else selects the panel, so an untouched URL is the shape the app already had. */
export const FILTER_EXPERIMENT_PARAM = "filterui";

/** The value that selects the Filterleiste. */
const LEISTE = "leiste";

export function FilterExperiment<TItem>({
  facets,
  items,
  triggerLabel,
}: {
  facets: readonly Facet<TItem>[];
  items: TItem[];
  triggerLabel?: string;
}) {
  const searchParams = useSearchParams();

  if (searchParams.get(FILTER_EXPERIMENT_PARAM) === LEISTE) {
    return (
      <FilterLeiste
        facets={facets}
        items={items}
      />
    );
  }

  return (
    <FilterBar
      facets={facets}
      items={items}
      triggerLabel={triggerLabel}
    />
  );
}
