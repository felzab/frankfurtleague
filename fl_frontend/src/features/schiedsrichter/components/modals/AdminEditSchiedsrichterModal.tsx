"use client";

import { FormModal } from "@/shared/components/ui/FormModal";

import AdminEditSchiedsrichterForm from "../forms/AdminEditSchiedsrichterForm";

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
  if (!schiedsrichterData) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Schiedsrichter bearbeiten">
      <AdminEditSchiedsrichterForm
        key={schiedsrichterData.id}
        schiedsrichterData={schiedsrichterData}
        onClose={onClose}
      />
    </FormModal>
  );
}
