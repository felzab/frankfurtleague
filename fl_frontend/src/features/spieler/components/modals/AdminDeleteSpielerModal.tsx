"use client";

import { deleteSpielerAction } from "@/features/spieler/actions";
import { kaderName, RETIREMENT_CONSEQUENCE } from "@/features/spieler/constants";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpielerRow } from "@/features/spieler/types";

/**
 * Retires the PERSON, not a squad row: this takes the player out of the league and leaves every
 * squad they have been in intact. Taking them out of one season's is the editor form's foot.
 */
export function AdminDeleteSpielerModal({
  spielerData,
  isOpen,
  onClose,
  onRetired,
}: {
  // The name's parts rather than the list's joined `fullName`: the editor holds the stored record, which carries none.
  spielerData: Pick<AdminSpielerRow, "id" | "vorname" | "nachname"> | null;
  isOpen: boolean;
  onClose: () => void;
  onRetired: () => void;
}) {
  const spieler = useRetainedValue(spielerData);

  if (!spieler) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      onRetired={onRetired}
      heading="Spieler stilllegen"
      entityLabel="den Spieler"
      entityName={kaderName(spieler)}
      consequence={RETIREMENT_CONSEQUENCE}
      successMessage="Spieler stillgelegt"
      failureMessage="Spieler nicht stillgelegt"
      onConfirm={() => deleteSpielerAction({ id: spieler.id })}
    />
  );
}
