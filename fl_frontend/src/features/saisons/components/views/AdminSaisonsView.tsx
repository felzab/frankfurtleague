"use client";

import { useMemo } from "react";

import { AdminSaisonsTable } from "@/features/saisons/components/collections/AdminSaisonsTable";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";
import { formatSpielDatum } from "@/shared/utils/format";

import type { AdminSaisonRow } from "@/features/saisons/types";

// Module scope: a fresh array here would defeat `useFuzzySearch`'s memo on every render. Dates are
// searchable in the German spelling the rows show and in the stored one, so a date typed either
// way finds the match.
const SEARCH_KEYS = ["id", "start_date", "end_date", "searchable_start_date", "searchable_end_date"] as const;

/**
 * Each sentence only where it is true, and `undefined` rather than an empty string where neither is, which
 * `Callout` would still give a paragraph's gap.
 */
function noticeBody(saisons: readonly AdminSaisonRow[]): string | undefined {
  // An empty league is the one the season-reading pages send here (`docs/frontend/spec.md :: I363`).
  if (saisons.length === 0) return "Lege eine Saison an, damit Handlungsbedarf, Finalrunden und Spielsuche etwas zeigen.";
  // The page it names is the planned season's, which a league holding ended seasons alone lacks.
  if (saisons.some((saison) => saison.status === "future")) return "Umgestellt wird auf der Seite der geplanten Saison.";

  return undefined;
}

/**
 * **No `renderDeleteModal`**: a season is never deleted, and its editor is a page, so the table's
 * pencil is a `<Link>` rather than a press.
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
    <div className="flex flex-col gap-4">
      {!saisons.some((saison) => saison.status === "active") && (
        <Callout
          severity="info"
          title="Derzeit ist keine Saison aktiv">
          {noticeBody(saisons)}
        </Callout>
      )}

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
    </div>
  );
}
