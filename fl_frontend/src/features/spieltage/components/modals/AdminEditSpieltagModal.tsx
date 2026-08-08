"use client";

import { AdminEditSpieltagForm } from "@/features/spieltage/components/forms/AdminEditSpieltagForm";
import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

export function AdminEditSpieltagModal({
  spieltagData,
  saisonSpan,
  isOpen,
  onClose,
}: {
  spieltagData: AdminSpieltagRow | null;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
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
        saisonSpan={saisonSpan}
        key={spieltag.id}
        spieltag={spieltag}
        onClose={onClose}
      />
    </FormModal>
  );
}
