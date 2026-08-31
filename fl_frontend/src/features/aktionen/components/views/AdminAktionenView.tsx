"use client";

import { AKTIONEN_FACETS } from "@/features/aktionen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminAktionenTable } from "../collections/AdminAktionenTable";

import type { AdminAktionRow } from "@/features/aktionen/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The collection
// is not among them because it is a facet: searching would match the stored name and not the label.
const SEARCH_KEYS = ["actor.email", "document_id", "correlation_id", "request.path"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the log is written by every other admin
 * page and edited by none, so a row has nothing to open and nothing to delete.
 */
export function AdminAktionenView({ aktionen, vollstaendig }: { aktionen: AdminAktionRow[]; vollstaendig: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Not dismissible: a standing property of the answer, and a closed notice would leave a
          partial log looking whole. */}
      {!vollstaendig && (
        <Callout
          severity="warning"
          title="Das Protokoll ist unvollständig">
          Geladen sind nur die neuesten Änderungen; ältere stehen nicht auf dieser Seite. Auch die Suche und die Filter erfassen nur die
          geladenen Zeilen.
        </Callout>
      )}

      <AdminCrudView<AdminAktionRow>
        items={aktionen}
        searchKeys={SEARCH_KEYS}
        facets={AKTIONEN_FACETS}
        renderTable={({ filteredItems, emptiness }) => (
          <AdminAktionenTable
            filteredAktionen={filteredItems}
            emptiness={emptiness}
          />
        )}
      />
    </div>
  );
}
