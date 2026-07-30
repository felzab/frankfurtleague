"use client";

import { FormModal } from "@/shared/components/ui/FormModal";

import AdminEditSpielortForm from "../forms/AdminEditSpielortForm";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminEditSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  if (!ortData) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielort bearbeiten">
      <AdminEditSpielortForm
        key={ortData.id}
        ortData={ortData}
        onClose={onClose}
      />
    </FormModal>
  );
}
