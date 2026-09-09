"use client";

import { useMemo } from "react";

import { AdminTeamsTable } from "@/features/teams/components/collections/AdminTeamsTable";
import { AdminDeleteTeamModal } from "@/features/teams/components/modals/AdminDeleteTeamModal";
import { buildTeamFacets } from "@/features/teams/facets";
import { AdminCrudView } from "@/shared/components/ui/AdminCrudView";

import type { AdminTeamRow } from "@/features/teams/types";

// Module scope: a fresh array would defeat `useFuzzySearch`'s memo on every render.
const SEARCH_KEYS = ["name", "full_name", "shorthand"] as const;

/** Club-centric rows spanning every season, with the selected season's junction data beside them. */
export function AdminTeamsView({ teams, numberOfGroups }: { teams: AdminTeamRow[]; numberOfGroups: number | null }) {
  // Built here rather than handed down: a facet carries a `read` function, which a Server Component
  // may not pass to a Client one (`.claude/rules/frontend.md`).
  const facets = useMemo(() => buildTeamFacets(numberOfGroups), [numberOfGroups]);

  return (
    <AdminCrudView<AdminTeamRow>
      items={teams}
      searchKeys={SEARCH_KEYS}
      facets={facets}
      renderTable={({ filteredItems, emptiness, onDelete }) => (
        <AdminTeamsTable
          filteredTeams={filteredItems}
          emptiness={emptiness}
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
