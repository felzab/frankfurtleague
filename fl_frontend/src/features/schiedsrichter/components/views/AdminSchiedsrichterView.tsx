"use client";

import { SCHIEDSRICHTER_FACETS, schiedsrichterFacetCounts } from "@/features/schiedsrichter/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminSchiedsrichterTable } from "../collections/AdminSchiedsrichterTable";
import { AdminDeleteSchiedsrichterModal } from "../modals/AdminDeleteSchiedsrichterModal";

import type { FLSchiedsrichter, FLSchiedsrichterListResponse } from "@/features/schiedsrichter/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "schule", "kontakt.email", "kontakt.telefon"] as const;

export function AdminSchiedsrichterView({
  schiedsrichter,
  anzahlJeAngabe,
}: {
  schiedsrichter: FLSchiedsrichter[];
  /** The endpoint's own counts: `schiedsrichter` holds no erased row unless the bar asked for one. */
  anzahlJeAngabe: FLSchiedsrichterListResponse["anzahl_je_angabe"];
}) {
  return (
    <AdminCrudView<FLSchiedsrichter>
      items={schiedsrichter}
      searchKeys={SEARCH_KEYS}
      facets={SCHIEDSRICHTER_FACETS}
      facetCounts={schiedsrichterFacetCounts({ anzahl_je_angabe: anzahlJeAngabe })}
      renderTable={({ filteredItems, emptiness, onDelete }) => (
        <AdminSchiedsrichterTable
          filteredSchiedsrichter={filteredItems}
          emptiness={emptiness}
          setDeletingSchiedsrichter={onDelete}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteSchiedsrichterModal
          schiedsrichterData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
