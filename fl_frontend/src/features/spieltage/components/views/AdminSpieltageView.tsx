"use client";

import { AdminSpieltageList } from "@/features/spieltage/components/collections/AdminSpieltageList";
import { AdminDeleteSpieltagModal } from "@/features/spieltage/components/modals/AdminDeleteSpieltagModal";
import { AdminEditSpieltagModal } from "@/features/spieltage/components/modals/AdminEditSpieltagModal";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. The phase is
// searchable by its STORED value rather than its German label, which is what a reader would type — but the
// list is sectioned by phase and labelled with the phase's own chip, so filtering by phase is what the
// sections already do and the search is for finding one matchday by name or date.
const SEARCH_KEYS = ["name", "beginn", "ende"] as const;

/**
 * The fifth declaration over `AdminCrudView` — and the first whose `renderTable` is not a table.
 *
 * That slot was always a slot: it takes whatever places many of one thing, and what a matchday list needs
 * is a phase-sectioned ordered list rather than a grid of cells (ADR-0063). The search, the edit overlay
 * and the retire overlay are unchanged from the four resources before it.
 *
 * **The editor is a dialog rather than a page**, which is where this differs from Teams, Spieler and
 * Saisons: six scalar fields with no nested object and no junction row do not reach ADR-0050's threshold.
 */
export function AdminSpieltageView({ spieltage, saisonId }: { spieltage: AdminSpieltagRow[]; saisonId: string | null }) {
  // Every position in the season, so a form can say that the one it holds is already taken. Computed from
  // the unfiltered list on purpose: a search must not make a collision disappear.
  const orderVals = spieltage.map((spieltag) => spieltag.order_val);

  return (
    <AdminCrudView<AdminSpieltagRow>
      items={spieltage}
      searchKeys={SEARCH_KEYS}
      renderTable={({ query, filteredItems, onEdit, onDelete }) => (
        <AdminSpieltageList
          spieltageQuery={query}
          filteredSpieltage={filteredItems}
          saisonId={saisonId}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      renderEditModal={({ item, isOpen, onClose }) => (
        <AdminEditSpieltagModal
          spieltagData={item}
          siblingOrderVals={orderVals}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteSpieltagModal
          spieltagData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
