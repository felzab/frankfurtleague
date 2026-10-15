"use client";

import { erteiltVonAnzeige, uebersprungenHinweis, vonOderGesperrt } from "@/features/berechtigungen/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminBerechtigungenList } from "../collections/AdminBerechtigungenList";

import type { FLBerechtigungZeile } from "@/features/berechtigungen/schemas";
import type { SearchKey } from "@/shared/hooks/useFuzzySearch";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. Each reads what
   the card prints through the card's own function (`docs/frontend/spec.md :: I681`). */
const SEARCH_KEYS: readonly SearchKey<FLBerechtigungZeile>[] = [
  { name: "adresse", getFn: (zeile) => vonOderGesperrt(zeile.adresse, zeile.gesperrt) },
  { name: "erteilt_von", getFn: (zeile) => erteiltVonAnzeige(zeile.erteilt_von, zeile.erteilt_von_gesperrt) },
];

/** **No `renderDeleteModal`**: a revoke is confirmed on the row itself, as a ban's removal is. */
export function AdminBerechtigungenView({
  berechtigungen,
  uebersprungen,
  inhaberAdresse,
}: {
  berechtigungen: FLBerechtigungZeile[];
  uebersprungen: number;
  inhaberAdresse: string | null;
}) {
  return (
    <div className="flex flex-col gap-4">
      {/* Not dismissible: a standing property of the store, which a closed notice would hide. */}
      {uebersprungen > 0 && (
        <Callout
          severity="warning"
          title="Diese Liste ist unvollständig">
          {uebersprungenHinweis(uebersprungen)}
        </Callout>
      )}

      <AdminCrudView<FLBerechtigungZeile>
        items={berechtigungen}
        searchKeys={SEARCH_KEYS}
        shape="cards"
        renderTable={({ filteredItems, emptiness }) => (
          <AdminBerechtigungenList
            filteredBerechtigungen={filteredItems}
            emptiness={emptiness}
            inhaberAdresse={inhaberAdresse}
          />
        )}
      />
    </div>
  );
}
