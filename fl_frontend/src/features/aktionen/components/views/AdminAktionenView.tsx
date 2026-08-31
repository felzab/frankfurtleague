"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AKTIONEN_FACETS } from "@/features/aktionen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";
import { textLink } from "@/shared/components/ui/textLink";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { AdminAktionenTable } from "../collections/AdminAktionenTable";

import type { AdminAktionRow } from "@/features/aktionen/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The collection
// is not among them because it is a facet: searching would match the stored name and not the label.
const SEARCH_KEYS = ["actor.email", "document_id", "correlation_id", "request.path"] as const;

/**
 * **Neither modal renderer is passed, and that is the shape of this resource**: the log is written by every other admin
 * page and edited by none, so a row has nothing to open and nothing to delete.
 */
export function AdminAktionenView({
  aktionen,
  vollstaendig,
  dokumentId,
}: {
  aktionen: AdminAktionRow[];
  vollstaendig: boolean;
  /** The one document the list is narrowed to, or null for the whole log — set by a row's history action. */
  dokumentId: string | null;
}) {
  // The way out of the narrowing keeps the shell on the selector's season (`withSaisonId`).
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");

  return (
    <div className="flex flex-col gap-4">
      {dokumentId !== null && (
        <Callout
          severity="info"
          title="Nur ein Datensatz">
          Angezeigt werden nur die Änderungen an dem Datensatz <span className="font-mono break-all">{dokumentId}</span>.{" "}
          <Link
            href={withSaisonId("/admin/aktionen", selectedFromUrl)}
            className={textLink()}>
            Alle Änderungen anzeigen
          </Link>
          .
        </Callout>
      )}

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
