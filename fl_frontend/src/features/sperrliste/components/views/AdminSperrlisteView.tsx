"use client";

import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminSperrlisteList } from "../collections/AdminSperrlisteList";

import type { FLSperrlisteEintrag } from "@/features/sperrliste/schemas";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. No address
   among the keys, a stored ban holding none. */
const SEARCH_KEYS = ["grund", "erstellt_von"] as const;

/**
 * **No `renderDeleteModal`**: removing a ban is confirmed on the row itself, through the shared
 * two-press control (`docs/frontend/spec.md :: I37`).
 */
export function AdminSperrlisteView({ sperrliste, anzahlGesamt }: { sperrliste: FLSperrlisteEintrag[]; anzahlGesamt: number }) {
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

      <AdminCrudView<FLSperrlisteEintrag>
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
