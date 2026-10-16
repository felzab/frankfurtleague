"use client";

import { deleteSchiedsrichterAction } from "@/features/schiedsrichter/actions";
import { SCHIEDSRICHTER_OHNE_NAMEN_LABEL, SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE } from "@/features/schiedsrichter/constants";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export function AdminDeleteSchiedsrichterModal({
  schiedsrichterData,
  isOpen,
  onClose,
  onRetired,
}: {
  schiedsrichterData: Pick<FLSchiedsrichter, "id" | "name"> | null;
  isOpen: boolean;
  onClose: () => void;
  onRetired: () => void;
}) {
  const schiedsrichter = useRetainedValue(schiedsrichterData);

  if (!schiedsrichter) return null;

  // Neither caller, the list nor the editor, serves an erased person or the ghost, so a missing name
  // here is what a hand-write left and never the erasure's doing.
  const nennung = schiedsrichter.name ?? SCHIEDSRICHTER_OHNE_NAMEN_LABEL;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      onRetired={onRetired}
      heading="Schiedsrichter stilllegen"
      entityLabel="den Schiedsrichter"
      entityName={nennung}
      consequence={SCHIEDSRICHTER_RETIREMENT_CONSEQUENCE}
      successMessage="Schiedsrichter stillgelegt"
      failureMessage="Schiedsrichter nicht stillgelegt"
      onConfirm={() => deleteSchiedsrichterAction({ id: schiedsrichter.id })}
    />
  );
}
