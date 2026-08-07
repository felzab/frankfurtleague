"use client";

import { AdminEditSpieltagForm } from "@/features/spieltage/components/forms/AdminEditSpieltagForm";
import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

export function AdminEditSpieltagModal({
  spieltagData,
  isOpen,
  onClose,
}: {
  spieltagData: AdminSpieltagRow | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const spieltag = useRetainedValue(spieltagData);

  if (!spieltag) return null;

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spieltag bearbeiten">
      <AdminEditSpieltagForm
        key={spieltag.id}
        spieltag={spieltag}
        onClose={onClose}
      />
    </FormModal>
  );
}
