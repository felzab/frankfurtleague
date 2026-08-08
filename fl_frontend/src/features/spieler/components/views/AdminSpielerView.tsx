"use client";

import { useMemo } from "react";

import { AdminSpielerTable } from "@/features/spieler/components/collections/AdminSpielerTable";
import { AdminDeleteSpielerModal } from "@/features/spieler/components/modals/AdminDeleteSpielerModal";
import { buildSpielerFacets } from "@/features/spieler/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminSpielerRow, SpielerTeamOption } from "@/features/spieler/types";

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
 *
 * **The facets are the one set in the app that is built rather than declared**, because the team facet's
 * options are the selected season's clubs — offering a club that plays in another season would narrow to
 * nothing and read as a defect. `useMemo` on the team list is what keeps the array's identity stable,
 * which `AdminCrudView`'s collection-identity constraint requires of it exactly as it requires of
 * `SEARCH_KEYS`.
 */
export function AdminSpielerView({
  spieler,
  teams,
  selectedSaisonId,
  selectedSaisonStatus,
}: {
  spieler: AdminSpielerRow[];
  /** The selected season's clubs, for the team facet's options. */
  teams: SpielerTeamOption[];
  selectedSaisonId: string;
  selectedSaisonStatus: "past" | "active" | "future";
}) {
  const facets = useMemo(() => buildSpielerFacets(teams), [teams]);

  return (
    <AdminCrudView<AdminSpielerRow>
      items={spieler}
      searchKeys={SEARCH_KEYS}
      facets={facets}
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
