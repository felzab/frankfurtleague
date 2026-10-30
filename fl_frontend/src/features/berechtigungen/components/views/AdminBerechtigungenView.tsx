"use client";

import { useId } from "react";

import { ALLE_ZUGAENGE, erteiltVonAnzeige, vonOderGesperrt } from "@/features/berechtigungen/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminBerechtigungAntraegeList } from "../collections/AdminBerechtigungAntraegeList";
import { AdminBerechtigungenList } from "../collections/AdminBerechtigungenList";

import type { FLGrantApprovalRequestRow, FLGrantRow } from "@/core/generated/client/types";
import type { SearchKey } from "@/shared/hooks/useFuzzySearch";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. Each reads what
   the card prints through the card's own function. */
const SEARCH_KEYS: readonly SearchKey<FLGrantRow>[] = [
  { name: "adresse", getFn: (zeile) => vonOderGesperrt(zeile.adresse, zeile.barred) },
  { name: "erteilt_von", getFn: (zeile) => erteiltVonAnzeige(zeile.granted_by, zeile.granted_by_barred) },
];

/** **No `renderDeleteModal`**: a revoke is confirmed on the row itself, as a ban's removal is. */
export function AdminBerechtigungenView({
  berechtigungen,
  antraege,
  inhaberAdresse,
}: {
  berechtigungen: FLGrantRow[];
  antraege: FLGrantApprovalRequestRow[];
  inhaberAdresse: string | null;
}) {
  const zugaengeId = useId();
  const mitAntraegen = antraege.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <AdminBerechtigungAntraegeList antraege={antraege} />

      <section className="flex w-full flex-col gap-3">
        {/* Under the requests' heading the grants would read as more requests; alone, the page's own title names them. */}
        {mitAntraegen && (
          <h2
            id={zugaengeId}
            className="fluid-xl font-extrabold tracking-tight text-foreground">
            {ALLE_ZUGAENGE}
          </h2>
        )}
        <AdminCrudView<FLGrantRow>
          items={berechtigungen}
          searchKeys={SEARCH_KEYS}
          shape="cards"
          renderTable={({ filteredItems, emptiness }) => (
            <AdminBerechtigungenList
              filteredBerechtigungen={filteredItems}
              emptiness={emptiness}
              inhaberAdresse={inhaberAdresse}
              ueberschriftId={mitAntraegen ? zugaengeId : null}
            />
          )}
        />
      </section>
    </div>
  );
}
