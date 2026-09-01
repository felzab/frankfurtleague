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
  const schiedsrichter = useRetainedValue(schiedsrichterData);

  if (!schiedsrichter) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Schiedsrichter stilllegen"
      entityLabel="den Schiedsrichter"
      entityName={schiedsrichter.name}
      consequence="Schon eingetragene Spiele behalten diesen Schiedsrichter. Er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Schiedsrichter stillgelegt"
      onConfirm={() => deleteSchiedsrichterAction({ id: schiedsrichter.id })}
    />
  );
}
