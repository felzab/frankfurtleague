"use client";

import { deleteSpielerAction } from "@/features/spieler/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpielerRow } from "@/features/spieler/types";

/**
 * Retires the PERSON, not a squad row. The two are independent (ADR-0025): this takes the player out
 * of the league entirely and leaves every squad they have ever been in intact, because those seasons
 * still happened. Taking them out of one season's squad is the editor's own control.
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
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const spieler = useRetainedValue(spielerData);

  if (!spieler) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spieler stilllegen"
      entityLabel="den Spieler"
      entityName={spieler.fullName}
      // The reactivation half moved into the shared escalation sentence, so this one states only what is
      // specific to a person: the squad rows of every season they played in survive.
      consequence="Seine Kadereinträge bleiben in jeder Saison erhalten, in der er gespielt hat. Der Spieler steht nur nicht mehr zur Auswahl."
      successMessage="Spieler stillgelegt"
      onConfirm={() => deleteSpielerAction({ id: spieler.id })}
    />
  );
}
