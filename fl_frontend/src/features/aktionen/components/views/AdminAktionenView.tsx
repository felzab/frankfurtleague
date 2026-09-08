"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { ArrowUpArrowDown } from "@gravity-ui/icons";

import { AKTIONEN_COLLECTION_PARAM, AKTIONEN_FACETS, AKTIONEN_OPERATION_PARAM, aktionenLeserichtung } from "@/features/aktionen/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";
import { Callout } from "@/shared/components/ui/Callout";
import { textLink } from "@/shared/components/ui/textLink";
import { withSaisonId } from "@/shared/utils/saisonHref";

import { AdminAktionenTable } from "../collections/AdminAktionenTable";

import type { FLAktionenListResponse } from "@/features/aktionen/schemas";
import type { AdminAktionRow } from "@/features/aktionen/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The collection
// is not among them because it is a facet: searching would match the stored name and not the label.
const SEARCH_KEYS = ["actor.email", "document_id", "trace_id", "request.path"] as const;

/**
 * The reversal's own box. Declared here rather than taken from `FilterLeiste`, whose control shell is
 * private to it and whose row this cannot join: `AdminCrudView` draws that row and offers no slot.
 */
const ORDER_CONTROL =
  "border-border bg-surface fluid-xs text-foreground hover:bg-hover flex h-10 shrink-0 cursor-pointer flex-row items-center gap-x-2 " +
  "rounded-xl border px-3 font-bold whitespace-nowrap shadow-sm transition-colors duration-(--motion-fast)";

/**
 * **No `renderDeleteModal`**: the log is written by every other admin page and never from here, so a row is read and
 * never changed.
 */
export function AdminAktionenView({
  aktionen,
  vollstaendig,
  anzahlJeCollection,
  anzahlJeOperation,
  dokumentId,
  vorgangId,
}: {
  aktionen: AdminAktionRow[];
  vollstaendig: boolean;
  /** The endpoint's own counts. `aktionen` holds only what the two narrowing facets selected, so it cannot answer for the rest. */
  anzahlJeCollection: FLAktionenListResponse["anzahl_je_collection"];
  anzahlJeOperation: FLAktionenListResponse["anzahl_je_operation"];
  /** The one document the list is narrowed to, or null for the whole log — set by a row's history action. */
  dokumentId: string | null;
  /** The one Vorgang the list is narrowed to, or null — set by a row's copy action, and answered whole. */
  vorgangId: string | null;
}) {
  // The way out of the narrowing keeps the shell on the selector's season (`withSaisonId`).
  const searchParams = useSearchParams();
  const selectedFromUrl = searchParams.get("saison_id");
  const { richtung, umkehrHref } = aktionenLeserichtung(new URLSearchParams(searchParams.toString()));

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
          Angezeigt werden alle Zeilen des Vorgangs <span className="font-mono break-all">{vorgangId}</span>, vollständig.{" "}
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
          die Suche erfasst nur die geladenen Zeilen. Die Zahlen an den Filtern „Bereich“ und „Art“ zählen dagegen das ganze Protokoll.
        </Callout>
      )}

      {/* Its own row above the bar rather than inside it, for the reason `ORDER_CONTROL` carries. */}
      <div className="flex w-full flex-row items-center gap-2">
        <Link
          href={umkehrHref}
          className={ORDER_CONTROL}>
          <ArrowUpArrowDown
            aria-hidden="true"
            width={16}
            height={16}
          />
          {richtung === "desc" ? "Älteste zuerst laden" : "Neueste zuerst laden"}
        </Link>
      </div>

      <AdminCrudView<AdminAktionRow>
        items={aktionen}
        searchKeys={SEARCH_KEYS}
        facets={AKTIONEN_FACETS}
        facetCounts={{ [AKTIONEN_COLLECTION_PARAM]: anzahlJeCollection, [AKTIONEN_OPERATION_PARAM]: anzahlJeOperation }}
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
