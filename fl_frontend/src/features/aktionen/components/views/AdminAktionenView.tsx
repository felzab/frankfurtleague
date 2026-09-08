"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AKTIONEN_FACETS, aktionenLogFacetCounts } from "@/features/aktionen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";
import { textLink } from "@/shared/components/ui/textLink";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { AdminAktionenTable } from "../collections/AdminAktionenTable";

import type { FLAktionenListResponse } from "@/features/aktionen/schemas";
import type { AdminAktionRow } from "@/features/aktionen/types";
import type { Leserichtung } from "@/shared/utils/leserichtung";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The collection
// is not among them because it is a facet: searching would match the stored name and not the label.
const SEARCH_KEYS = ["actor.email", "document_id", "trace_id", "request.path"] as const;

/**
 * **No `renderDeleteModal`**: the log is written by every other admin page and never from here, so a row is read and
 * never changed.
 */
export function AdminAktionenView({
  aktionen,
  vollstaendig,
  anzahlJeCollection,
  anzahlJeOperation,
  anzahlJeHerkunft,
  dokumentId,
  vorgangId,
  richtung,
}: {
  aktionen: AdminAktionRow[];
  vollstaendig: boolean;
  /** The endpoint's own counts, one map per facet: `aktionen` holds only what the narrowing selected, so it cannot answer for the rest. */
  anzahlJeCollection: FLAktionenListResponse["anzahl_je_collection"];
  anzahlJeOperation: FLAktionenListResponse["anzahl_je_operation"];
  anzahlJeHerkunft: FLAktionenListResponse["anzahl_je_herkunft"];
  /** The one document the list is narrowed to, or null for the whole log — set by a row's history action. */
  dokumentId: string | null;
  /** The one Vorgang the list is narrowed to, or null — set by a row's copy action, and served under the same cap. */
  vorgangId: string | null;
  /** The end the rows below were served from, so the notice and the bar's control cannot name different ones. */
  richtung: Leserichtung;
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

      {/* The number itself, so it can be read off the page and quoted in a support request: no cell
          renders it, and the row action that led here put it in the URL rather than on screen. */}
      {vorgangId !== null && (
        <Callout
          severity="info"
          title="Nur ein Vorgang">
          Angezeigt werden die Zeilen des Vorgangs <span className="font-mono break-all">{vorgangId}</span>
          {vollstaendig && ", vollständig"}.{" "}
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
          Geladen sind nur {richtung === "desc" ? "die neuesten" : "die ältesten"} Änderungen; die übrigen stehen nicht auf dieser Seite. Auch
          die Suche erfasst nur die geladenen Zeilen. Die Zahlen an den Filtern zählen dagegen{" "}
          {dokumentId !== null || vorgangId !== null ? "alle Zeilen der oben genannten Auswahl" : "das ganze Protokoll"}.
        </Callout>
      )}

      <AdminCrudView<AdminAktionRow>
        items={aktionen}
        searchKeys={SEARCH_KEYS}
        facets={AKTIONEN_FACETS}
        facetCounts={aktionenLogFacetCounts({
          anzahl_je_collection: anzahlJeCollection,
          anzahl_je_operation: anzahlJeOperation,
          anzahl_je_herkunft: anzahlJeHerkunft,
        })}
        leserichtung={richtung}
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
