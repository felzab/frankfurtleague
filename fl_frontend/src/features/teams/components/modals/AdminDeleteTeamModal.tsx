"use client";

import { deleteTeamAction } from "@/features/teams/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminTeamRow } from "@/features/teams/types";

export function AdminDeleteTeamModal({ teamData, isOpen, onClose }: { teamData: AdminTeamRow | null; isOpen: boolean; onClose: () => void }) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const team = useRetainedValue(teamData);

  if (!team) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Team stilllegen"
      entityLabel="das Team"
      entityName={team.name}
      // The reactivation half moved into the shared escalation sentence, so this one states only what is
      // specific to a club: what survives the retirement, and that the shorthand stays taken.
      consequence="Seine Spiele, Saisons und Tabellen bleiben erhalten, und sein Kürzel bleibt reserviert. Das Team steht nur nicht mehr zur Auswahl."
      successMessage="Team stillgelegt"
      onConfirm={() => deleteTeamAction({ id: team.id })}
    />
  );
}
