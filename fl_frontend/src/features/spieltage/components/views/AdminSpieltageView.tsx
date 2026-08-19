"use client";

import { AdminSpieltageList } from "@/features/spieltage/components/collections/AdminSpieltageList";
import { AdminDeleteSpieltagModal } from "@/features/spieltage/components/modals/AdminDeleteSpieltagModal";
import { SPIELTAG_FACETS } from "@/features/spieltage/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { SpieltagPhaseProgress } from "@/features/spieltage/utils";

// Module scope: a fresh array here would defeat `useFuzzySearch`'s memo on every render. `label` is
// a field of the row rather than of the document, because a search matches what is read.
const SEARCH_KEYS = ["label", "beginn", "ende"] as const;

/**
 * `renderTable` is not a table: that slot takes whatever places many of one thing, and a matchday
 * list needs phase-sectioned order rather than a grid. `renderEditModal` is not passed — the form
 * edits on a page, so the row's pencil is a `<Link>`.
 */
export function AdminSpieltageView({
  spieltage,
  saisonId,
  phaseProgress,
}: {
  spieltage: AdminSpieltagRow[];
  saisonId: string | null;
  /**
   * Passed through untouched rather than derived here: both numbers are facts about the season rather
   * than about the filtered rows (`fl_frontend/src/features/spieltage/utils.ts :: buildSpieltagPhaseProgress`).
   */
  phaseProgress?: readonly SpieltagPhaseProgress[];
}) {
  return (
    <AdminCrudView<AdminSpieltagRow>
      isCollection={false}
      items={spieltage}
      searchKeys={SEARCH_KEYS}
      facets={SPIELTAG_FACETS}
      renderTable={({ query, filteredItems, onDelete }) => (
        <AdminSpieltageList
          spieltageQuery={query}
          filteredSpieltage={filteredItems}
          saisonId={saisonId}
          phaseProgress={phaseProgress}
          onDelete={onDelete}
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
