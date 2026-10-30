"use client";

import { useId } from "react";

import { ALLE_ZUGAENGE, erteiltVonAnzeige, uebersprungenHinweis, vonOderGesperrt } from "@/features/berechtigungen/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";

import { AdminBerechtigungAntraegeList } from "../collections/AdminBerechtigungAntraegeList";
import { AdminBerechtigungenList } from "../collections/AdminBerechtigungenList";

import type { FLBerechtigungAntragZeile, FLBerechtigungZeile } from "@/core/generated/client/types";
import type { SearchKey } from "@/shared/hooks/useFuzzySearch";

/* Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. Each reads what
   the card prints through the card's own function. */
const SEARCH_KEYS: readonly SearchKey<FLBerechtigungZeile>[] = [
  { name: "adresse", getFn: (zeile) => vonOderGesperrt(zeile.adresse, zeile.gesperrt) },
  { name: "erteilt_von", getFn: (zeile) => erteiltVonAnzeige(zeile.erteilt_von, zeile.erteilt_von_gesperrt) },
];

/** **No `renderDeleteModal`**: a revoke is confirmed on the row itself, as a ban's removal is. */
export function AdminBerechtigungenView({
  berechtigungen,
  uebersprungen,
  antraege,
  inhaberAdresse,
}: {
  berechtigungen: FLBerechtigungZeile[];
  uebersprungen: number;
  antraege: FLBerechtigungAntragZeile[];
  inhaberAdresse: string | null;
}) {
  const zugaengeId = useId();
  const mitAntraegen = antraege.length > 0;

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
        <AdminCrudView<FLBerechtigungZeile>
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
