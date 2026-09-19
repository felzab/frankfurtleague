"use client";

import { deleteTeamAction } from "@/features/teams/actions";
import { TEAM_RETIREMENT_CONSEQUENCE } from "@/features/teams/constants";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminTeamRow } from "@/features/teams/types";

export function AdminDeleteTeamModal({ teamData, isOpen, onClose }: { teamData: AdminTeamRow | null; isOpen: boolean; onClose: () => void }) {
  const team = useRetainedValue(teamData);

  if (!team) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Team stilllegen"
      entityLabel="das Team"
      entityName={team.name}
      consequence={TEAM_RETIREMENT_CONSEQUENCE}
      successMessage="Team stillgelegt"
      failureMessage="Team nicht stillgelegt"
      onConfirm={() => deleteTeamAction({ id: team.id })}
    />
  );
}
