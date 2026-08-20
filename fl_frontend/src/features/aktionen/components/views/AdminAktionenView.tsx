"use client";

import { AKTIONEN_FACETS } from "@/features/aktionen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminAktionenTable } from "../collections/AdminAktionenTable";

import type { AdminAktionRow } from "@/features/aktionen/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The collection
// is not among them because it is a facet: searching would match the stored name and not the label.
const SEARCH_KEYS = ["actor.email", "document_id", "correlation_id", "request.path"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the log is written by every other admin
 * page and edited by none, so a row has nothing to open and nothing to delete.
 */
export function AdminAktionenView({ aktionen }: { aktionen: AdminAktionRow[] }) {
  return (
    <AdminCrudView<AdminAktionRow>
      items={aktionen}
      searchKeys={SEARCH_KEYS}
      facets={AKTIONEN_FACETS}
      renderTable={({ query, filteredItems }) => (
        <AdminAktionenTable
          aktionenQuery={query}
          filteredAktionen={filteredItems}
        />
      )}
    />
  );
}
