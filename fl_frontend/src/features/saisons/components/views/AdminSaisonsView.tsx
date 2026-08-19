"use client";

import { AdminSaisonsTable } from "@/features/saisons/components/collections/AdminSaisonsTable";
import { SAISON_FACETS } from "@/features/saisons/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Module scope: a fresh array here would defeat `useFuzzySearch`'s memo on every render. The dates
// are searchable because an admin looks for a season by when it ran.
const SEARCH_KEYS = ["id", "start_date", "end_date"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the editor is a page,
 * so the table's pencil is a `<Link>`, and there is no delete at all.
 */
export function AdminSaisonsView({ saisons }: { saisons: AdminSaisonRow[] }) {
  return (
    <AdminCrudView<AdminSaisonRow>
      items={saisons}
      searchKeys={SEARCH_KEYS}
      facets={SAISON_FACETS}
      renderTable={({ query, filteredItems }) => (
        <AdminSaisonsTable
          saisonsQuery={query}
          filteredSaisons={filteredItems}
        />
      )}
    />
  );
}
