"use client";

import { AdminSpieltageList } from "@/features/spieltage/components/collections/AdminSpieltageList";
import { AdminDeleteSpieltagModal } from "@/features/spieltage/components/modals/AdminDeleteSpieltagModal";
import { SPIELTAG_FACETS } from "@/features/spieltage/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { SpieltagPhaseProgress } from "@/features/spieltage/utils";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. A matchday is
// found by its derived label or by either date; `label` is a field of the row, not of the document,
// because a search matches what is read.
const SEARCH_KEYS = ["label", "beginn", "ende"] as const;

/**
 * A declaration over `AdminCrudView` whose `renderTable` is not a table.
 *
 * That slot is a slot: it takes whatever places many of one thing, and what a matchday list needs is
 * a phase-sectioned ordered list rather than a grid of cells. The search, the edit overlay
 * and the retire overlay are the ones every admin resource gets.
 *
 * `renderEditModal` is deliberately not passed: the matchday form edits on a page at
 * `/admin/spieltage/[spieltag_id]`, so the row's pencil is a `<Link>` and the shared view
 * renders no edit overlay.
 */
export function AdminSpieltageView({
  spieltage,
  saisonId,
  phaseProgress,
}: {
  spieltage: AdminSpieltagRow[];
  saisonId: string | null;
  /**
   * Each phase's live matchday count against the number the season's rules imply.
   *
   * Passed through untouched rather than derived here: both numbers are facts about the season rather than
   * about the filtered rows (`fl_frontend/src/features/spieltage/utils.ts :: buildSpieltagPhaseProgress`).
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
