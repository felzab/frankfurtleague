"use client";

import { deleteSpielerAction } from "@/features/spieler/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpielerRow } from "@/features/spieler/types";

/**
 * Retires the PERSON, not a squad row: this takes the player out of the league and leaves every
 * squad they have been in intact. Taking them out of one season's is the editor's own control.
 */
export function AdminDeleteSpielerModal({
  spielerData,
  isOpen,
  onClose,
}: {
  spielerData: AdminSpielerRow | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  const spieler = useRetainedValue(spielerData);

  if (!spieler) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spieler stilllegen"
      entityLabel="den Spieler"
      entityName={spieler.fullName}
      consequence="Seine Kadereinträge bleiben in jeder Saison erhalten. Für neue Kader steht er nicht mehr zur Auswahl."
      successMessage="Spieler stillgelegt"
      onConfirm={() => deleteSpielerAction({ id: spieler.id })}
    />
  );
}
