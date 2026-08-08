"use client";

import { AdminSaisonsTable } from "@/features/saisons/components/collections/AdminSaisonsTable";
import { SAISON_FACETS } from "@/features/saisons/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. `id` alone is
// not enough — an admin looking for a season by when it ran should find it by year, so both dates are
// searchable and the four-character id happens to be a year too.
const SEARCH_KEYS = ["id", "start_date", "end_date"] as const;

/**
 * The fourth declaration over `AdminCrudView` — Schiedsrichter, Spielorte and Teams are the others.
 *
 * **Neither modal renderer is passed, and that is the whole shape of this resource.** The editor is a
 * page at `/admin/saisons/[saison_id]` (ADR-0050), so the table's pencil is a `<Link>`; and there is no
 * delete at all, because a season that is over is `past` rather than gone (ADR-0033).
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
