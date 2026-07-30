"use client";

import { deleteSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";

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
  if (!schiedsrichterData) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Schiedsrichter löschen"
      entityLabel="den Schiedsrichter"
      entityName={schiedsrichterData.name}
      consequence="Bereits eingetragene Spiele behalten den hier hinterlegten Schiedsrichter — er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Schiedsrichter erfolgreich gelöscht"
      onConfirm={() => deleteSchiedsrichterAction({ id: schiedsrichterData.id })}
    />
  );
}
