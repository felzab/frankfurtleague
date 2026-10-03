"use client";

import { uebersprungenHinweis } from "@/features/berechtigungen/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminBerechtigungenList } from "../collections/AdminBerechtigungenList";

import type { FLBerechtigungZeile } from "@/features/berechtigungen/schemas";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. */
const SEARCH_KEYS = ["adresse", "erteilt_von"] as const;

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
