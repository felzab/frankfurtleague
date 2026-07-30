"use client";

import { FormModal } from "@/shared/components/ui/FormModal";

import AdminEditSpielDataForm from "../forms/AdminEditSpielDataForm/AdminEditSpielDataForm";

import type { FLSpiel } from "@/features/spiele/schemas";

export default function AdminEditSpielDataModal({
  spielData,
  isOpen,
  onClose,
}: {
  spielData: FLSpiel | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!spielData) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielinformationen bearbeiten">
      <AdminEditSpielDataForm
        key={spielData.id}
        spielData={spielData}
        onClose={onClose}
      />
    </FormModal>
  );
}
