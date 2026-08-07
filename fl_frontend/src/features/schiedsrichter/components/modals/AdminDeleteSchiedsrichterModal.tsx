"use client";

import { deleteSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export function AdminDeleteSchiedsrichterModal({
  schiedsrichterData,
  isOpen,
  onClose,
}: {
  schiedsrichterData: FLSchiedsrichter | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const schiedsrichter = useRetainedValue(schiedsrichterData);

  if (!schiedsrichter) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Schiedsrichter löschen"
      entityLabel="den Schiedsrichter"
      entityName={schiedsrichter.name}
      consequence="Bereits eingetragene Spiele behalten den hier hinterlegten Schiedsrichter. Er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Schiedsrichter erfolgreich gelöscht"
      onConfirm={() => deleteSchiedsrichterAction({ id: schiedsrichter.id })}
    />
  );
}
