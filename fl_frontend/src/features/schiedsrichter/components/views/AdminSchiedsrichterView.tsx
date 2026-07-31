"use client";

import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import AdminSchiedsrichterTable from "../collections/AdminSchiedsrichterTable";
import { AdminCreateSchiedsrichterModal } from "../modals/AdminCreateSchiedsrichterModal";
import { AdminDeleteSchiedsrichterModal } from "../modals/AdminDeleteSchiedsrichterModal";
import { AdminEditSchiedsrichterModal } from "../modals/AdminEditSchiedsrichterModal";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "schule", "kontakt.email", "kontakt.telefon"] as const;

export function AdminSchiedsrichterView({ schiedsrichter }: { schiedsrichter: FLSchiedsrichter[] }) {
  return (
    <AdminCrudView<FLSchiedsrichter>
      title="Schiedsrichter"
      description="Verwalte alle Schiedsrichter, deren Kontaktdaten und Honorare."
      createModal={<AdminCreateSchiedsrichterModal />}
      searchLabel="Schiedsrichter suchen"
      searchPlaceholder="Suchen nach Name, Schule, E-Mail..."
      items={schiedsrichter}
      searchKeys={SEARCH_KEYS}
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
