"use client";

import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import { AdminEditSchiedsrichterForm } from "../forms/AdminEditSchiedsrichterForm";

import type { FLSchiedsrichter } from "@/features/schiedsrichter/schemas";

export function AdminEditSchiedsrichterModal({
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
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Schiedsrichter bearbeiten">
      <AdminEditSchiedsrichterForm
        key={schiedsrichter.id}
        schiedsrichterData={schiedsrichter}
        onClose={onClose}
      />
    </FormModal>
  );
}
