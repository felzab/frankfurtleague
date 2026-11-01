"use client";

import { vonOderGesperrt } from "@/features/berechtigungen/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminSperrlisteList } from "../collections/AdminSperrlisteList";

import type { FLSperrlisteRow } from "@/core/generated/client/types";
import type { SearchKey } from "@/shared/hooks/useFuzzySearch";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. No address
   among the keys, a stored ban holding none; the author is read as its card prints it. */
const SEARCH_KEYS: readonly SearchKey<FLSperrlisteRow>[] = [
  "grund",
  { name: "erstellt_von", getFn: (eintrag) => vonOderGesperrt(eintrag.created_by, eintrag.created_by_barred) },
];

/**
 * **No `renderDeleteModal`**: removing a ban is confirmed on the row itself, through the shared
 * two-press control.
 */
export function AdminSperrlisteView({ sperrliste, anzahlGesamt }: { sperrliste: FLSperrlisteRow[]; anzahlGesamt: number }) {
  return (
    <div className="flex flex-col gap-4">
      {/* Not dismissible: a standing property of the answer, and a closed notice would leave a
          capped list looking whole. Both numbers are at or above the endpoint's cap wherever this
          renders, so neither can take a singular. */}
      {anzahlGesamt > sperrliste.length && (
        <Callout
          severity="warning"
          title="Diese Liste ist unvollständig">
          Gesperrt sind {anzahlGesamt} Adressen, geladen sind die {sperrliste.length} neuesten. Die übrigen Sperren gelten weiter, stehen aber
          nicht auf dieser Seite und lassen sich hier nicht aufheben. Auch die Suche erfasst nur die geladenen Sperren.
        </Callout>
      )}

      <AdminCrudView<FLSperrlisteRow>
        items={sperrliste}
        searchKeys={SEARCH_KEYS}
        shape="cards"
        renderTable={({ filteredItems, emptiness }) => (
          <AdminSperrlisteList
            filteredSperren={filteredItems}
            emptiness={emptiness}
          />
        )}
      />
    </div>
  );
}
