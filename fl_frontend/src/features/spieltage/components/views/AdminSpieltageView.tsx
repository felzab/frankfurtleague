"use client";

import { AdminSpieltageList } from "@/features/spieltage/components/collections/AdminSpieltageList";
import { AdminDeleteSpieltagModal } from "@/features/spieltage/components/modals/AdminDeleteSpieltagModal";
import { AdminEditSpieltagModal } from "@/features/spieltage/components/modals/AdminEditSpieltagModal";
import { SPIELTAG_FACETS } from "@/features/spieltage/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";
import type { SpieltagPhaseProgress } from "@/features/spieltage/utils";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render. A matchday is
// found by its derived label or by either date; `label` is a field of the row, not of the document
// (ADR-0051), because a search matches what is read.
const SEARCH_KEYS = ["label", "beginn", "ende"] as const;

/**
 * A declaration over `AdminCrudView` whose `renderTable` is not a table.
 *
 * That slot is a slot: it takes whatever places many of one thing, and what a matchday list needs is
 * a phase-sectioned ordered list rather than a grid of cells (ADR-0050). The search, the edit overlay
 * and the retire overlay are the ones every admin resource gets.
 *
 * **The editor is a dialog rather than a page**, which is where this differs from Teams, Spieler and
 * Saisons: three scalar fields with no nested object and no junction row do not reach ADR-0040's
 * threshold.
 */
export function AdminSpieltageView({
  spieltage,
  saisonId,
  saisonSpan,
  saisonSchedule,
  phaseProgress,
}: {
  spieltage: AdminSpieltagRow[];
  saisonId: string | null;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The season's derived per-phase match counts, which bound the edit dialog's phase picker. */
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
  /**
   * Each phase's live matchday count against the number the season's rules imply.
   *
   * Passed through untouched rather than derived here: it is counted over the WHOLE season on the
   * server, and re-deriving it beside the filtered rows is exactly what would make it wrong.
   */
  phaseProgress?: readonly SpieltagPhaseProgress[];
}) {
  return (
    <AdminCrudView<AdminSpieltagRow>
      items={spieltage}
      searchKeys={SEARCH_KEYS}
      facets={SPIELTAG_FACETS}
      renderTable={({ query, filteredItems, onEdit, onDelete }) => (
        <AdminSpieltageList
          spieltageQuery={query}
          filteredSpieltage={filteredItems}
          saisonId={saisonId}
          phaseProgress={phaseProgress}
          onEdit={onEdit}
          onDelete={onDelete}
        />
      )}
      renderEditModal={({ item, isOpen, onClose }) => (
        <AdminEditSpieltagModal
          spieltagData={item}
          saisonSpan={saisonSpan}
          saisonSchedule={saisonSchedule}
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
