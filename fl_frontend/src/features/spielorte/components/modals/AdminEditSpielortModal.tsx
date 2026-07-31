"use client";

import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import AdminEditSpielortForm from "../forms/AdminEditSpielortForm";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminEditSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const ort = useRetainedValue(ortData);

  if (!ort) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielort bearbeiten">
      <AdminEditSpielortForm
        key={ort.id}
        ortData={ort}
        onClose={onClose}
      />
    </FormModal>
  );
}
