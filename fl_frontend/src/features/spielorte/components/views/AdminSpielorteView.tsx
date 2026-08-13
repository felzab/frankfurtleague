"use client";

import { SPIELORT_FACETS } from "@/features/spielorte/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import { AdminSpielorteTable } from "../collections/AdminSpielorteTable";
import { AdminDeleteSpielortModal } from "../modals/AdminDeleteSpielortModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "address.plz", "address.strasse", "address.stadtteil"] as const;

/**
 * `renderEditModal` is deliberately not passed: the venue form edits on a page at
 * `/admin/spielorte/[spielort_id]` (ADR-0040), so the table's pencil is a `<Link>` and the shared
 * view renders no edit overlay — the arrangement Teams and Spieler already have.
 */
export function AdminSpielorteView({ spielorte }: { spielorte: FLSpielort[] }) {
  return (
    <AdminCrudView<FLSpielort>
      items={spielorte}
      searchKeys={SEARCH_KEYS}
      facets={SPIELORT_FACETS}
      renderTable={({ query, filteredItems, onDelete }) => (
        <AdminSpielorteTable
          spielortQuery={query}
          filteredSpielorte={filteredItems}
          setDeletingOrt={onDelete}
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
