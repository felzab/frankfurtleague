"use client";

import { AdminTeamsTable } from "@/features/teams/components/collections/AdminTeamsTable";
import { AdminDeleteTeamModal } from "@/features/teams/components/modals/AdminDeleteTeamModal";
import { TEAM_FACETS } from "@/features/teams/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminTeamRow } from "@/features/teams/types";

// Module scope: a fresh array would defeat `useFuzzySearch`'s memo on every render.
const SEARCH_KEYS = ["name", "full_name", "shorthand"] as const;

/** Club-centric rows spanning every season, with the selected season's junction data beside them. */
export function AdminTeamsView({ teams, selectedSaisonStatus }: { teams: AdminTeamRow[]; selectedSaisonStatus: "past" | "active" | "future" }) {
  return (
    <AdminCrudView<AdminTeamRow>
      items={teams}
      searchKeys={SEARCH_KEYS}
      facets={TEAM_FACETS}
      renderTable={({ filteredItems, emptiness, onDelete }) => (
        <AdminTeamsTable
          filteredTeams={filteredItems}
          emptiness={emptiness}
          selectedSaisonStatus={selectedSaisonStatus}
          setDeletingTeam={onDelete}
        />
      )}
      renderDeleteModal={({ item, isOpen, onClose }) => (
        <AdminDeleteTeamModal
          teamData={item}
          isOpen={isOpen}
          onClose={onClose}
        />
      )}
    />
  );
}
