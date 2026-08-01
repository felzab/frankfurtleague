"use client";

import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import AdminSpielorteTable from "../collections/AdminSpielorteTable";
import { AdminDeleteSpielortModal } from "../modals/AdminDeleteSpielortModal";
import { AdminEditSpielortModal } from "../modals/AdminEditSpielortModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "address.plz", "address.strasse", "address.stadtteil"] as const;

export function AdminSpielorteView({ spielorte }: { spielorte: FLSpielort[] }) {
  return (
    <AdminCrudView<FLSpielort>
      searchLabel={SPIELORTE_CRUD_COPY.searchLabel}
      searchPlaceholder={SPIELORTE_CRUD_COPY.searchPlaceholder}
      items={spielorte}
      searchKeys={SEARCH_KEYS}
      renderTable={({ query, filteredItems, onEdit, onDelete }) => (
        <AdminSpielorteTable
          spielortQuery={query}
          filteredSpielorte={filteredItems}
          setEditingOrt={onEdit}
          setDeletingOrt={onDelete}
        />
      )}
      renderEditModal={({ item, isOpen, onClose }) => (
        <AdminEditSpielortModal
          ortData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteSpielortModal
          ortData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
