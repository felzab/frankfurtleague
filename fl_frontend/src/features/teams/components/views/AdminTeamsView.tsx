"use client";

import { AdminTeamsTable } from "@/features/teams/components/collections/AdminTeamsTable";
import { AdminDeleteTeamModal } from "@/features/teams/components/modals/AdminDeleteTeamModal";
import { TEAMS_CRUD_COPY } from "@/features/teams/constants";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminTeamRow } from "@/features/teams/types";

// Module scope: a fresh array here would defeat useFuzzySearch's memo on every render.
const SEARCH_KEYS = ["name", "full_name", "shorthand"] as const;

/**
 * The third declaration over `AdminCrudView` — Schiedsrichter and Spielorte are the other two.
 *
 * The items are club-centric rows spanning every season, with the selected season's junction data
 * beside them. `renderEditModal` is deliberately not passed: the club form edits on a page at
 * `/admin/teams/[team_id]` (ADR-0050), so the table's pencil is a `<Link>` and the shared view
 * renders no edit overlay.
 */
export function AdminTeamsView({ teams, selectedSaisonId }: { teams: AdminTeamRow[]; selectedSaisonId: string }) {
  return (
    <AdminCrudView<AdminTeamRow>
      searchLabel={TEAMS_CRUD_COPY.searchLabel}
      searchPlaceholder={TEAMS_CRUD_COPY.searchPlaceholder}
      items={teams}
      searchKeys={SEARCH_KEYS}
      renderTable={({ query, filteredItems, onDelete }) => (
        <AdminTeamsTable
          teamsQuery={query}
          filteredTeams={filteredItems}
          selectedSaisonId={selectedSaisonId}
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
