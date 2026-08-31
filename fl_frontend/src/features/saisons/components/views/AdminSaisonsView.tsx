"use client";

import { useMemo } from "react";

import { AdminSaisonsTable } from "@/features/saisons/components/collections/AdminSaisonsTable";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Module scope: a fresh array here would defeat `useFuzzySearch`'s memo on every render. Dates are
// searchable in the German spelling the rows show and in the stored one, so a date typed either
// way finds the match.
const SEARCH_KEYS = ["id", "start_date", "end_date", "searchable_start_date", "searchable_end_date"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the editor is a page,
 * so the table's pencil is a `<Link>`, and there is no delete at all.
 */
export function AdminSaisonsView({ saisons }: { saisons: AdminSaisonRow[] }) {
  // A reader types the spelling they have seen on the rows. Deriving it through the formatter the
  // table renders with — never a string reversal — is what keeps the two spellings agreeing.
  const processedSaisons = useMemo(
    () =>
      saisons.map((saison) => ({
        ...saison,
        searchable_start_date: formatSpielDatum(saison.start_date),
        searchable_end_date: formatSpielDatum(saison.end_date),
      })),
    [saisons],
  );

  return (
    <AdminCrudView<AdminSaisonRow>
      items={processedSaisons}
      searchKeys={SEARCH_KEYS}
      renderTable={({ filteredItems, emptiness }) => (
        <AdminSaisonsTable
          filteredSaisons={filteredItems}
          emptiness={emptiness}
        />
      )}
    />
  );
}
