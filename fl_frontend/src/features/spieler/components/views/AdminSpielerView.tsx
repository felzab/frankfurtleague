"use client";

import { AdminSpielerTable } from "@/features/spieler/components/collections/AdminSpielerTable";
import { AdminDeleteSpielerModal } from "@/features/spieler/components/modals/AdminDeleteSpielerModal";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpielerRow } from "@/features/spieler/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The two
// squad keys are flattened onto the row by the page precisely so they can be searched by name —
// "Helmholtz" and "10" are how an admin looks a player up, not by id.
const SEARCH_KEYS = ["fullName", "selected.teamName", "selected.nummer"] as const;

/**
 * The fourth declaration over `AdminCrudView` — Schiedsrichter, Spielorte and Teams are the others.
 *
 * The items are player-centric rows spanning every season, with the selected season's squad row
 * beside them. `renderEditModal` is deliberately not passed: the player form edits on a page at
 * `/admin/spieler/[spieler_id]` (ADR-0050), so the table's pencil is a `<Link>` and the shared view
 * renders no edit overlay.
 */
export function AdminSpielerView({
  spieler,
  selectedSaisonId,
  selectedSaisonStatus,
}: {
  spieler: AdminSpielerRow[];
  selectedSaisonId: string;
  selectedSaisonStatus: "past" | "active" | "future";
}) {
  return (
    <AdminCrudView<AdminSpielerRow>
      items={spieler}
      searchKeys={SEARCH_KEYS}
      renderTable={({ query, filteredItems, onDelete }) => (
        <AdminSpielerTable
          spielerQuery={query}
          filteredSpieler={filteredItems}
          selectedSaisonId={selectedSaisonId}
          selectedSaisonStatus={selectedSaisonStatus}
          setDeletingSpieler={onDelete}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteSpielerModal
          spielerData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
