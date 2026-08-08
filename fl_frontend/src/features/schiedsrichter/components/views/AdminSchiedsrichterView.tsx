"use client";

import { SCHIEDSRICHTER_FACETS } from "@/features/schiedsrichter/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminSchiedsrichterTable } from "../collections/AdminSchiedsrichterTable";
import { AdminDeleteSchiedsrichterModal } from "../modals/AdminDeleteSchiedsrichterModal";
import { AdminEditSchiedsrichterModal } from "../modals/AdminEditSchiedsrichterModal";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "schule", "kontakt.email", "kontakt.telefon"] as const;

export function AdminSchiedsrichterView({ schiedsrichter }: { schiedsrichter: FLSchiedsrichter[] }) {
  return (
    <AdminCrudView<FLSchiedsrichter>
      items={schiedsrichter}
      searchKeys={SEARCH_KEYS}
      facets={SCHIEDSRICHTER_FACETS}
      renderTable={({ query, filteredItems, onEdit, onDelete }) => (
        <AdminSchiedsrichterTable
          schiedsrichterQuery={query}
          filteredSchiedsrichter={filteredItems}
          setEditingSchiedsrichter={onEdit}
          setDeletingSchiedsrichter={onDelete}
        />
      )}
      renderEditModal={({ item, isOpen, onClose }) => (
        <AdminEditSchiedsrichterModal
          schiedsrichterData={item}
          isOpen={isOpen}
          onClose={onClose}
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
