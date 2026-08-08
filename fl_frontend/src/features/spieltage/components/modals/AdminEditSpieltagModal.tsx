"use client";

import { AdminEditSpieltagForm } from "@/features/spieltage/components/forms/AdminEditSpieltagForm";
import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { FLSaisonPhaseSchedule } from "@/features/saisons/schemas";
import type { AdminSpieltagRow } from "@/features/spieltage/types";

export function AdminEditSpieltagModal({
  spieltagData,
  saisonSpan,
  saisonSchedule,
  isOpen,
  onClose,
}: {
  spieltagData: AdminSpieltagRow | null;
  /** The season's own span, which bounds both date pickers (`REQ-DATE-002`). */
  saisonSpan?: { start: string; end: string };
  /** The season's derived per-phase match counts, which bound the phase picker (`REQ-SPIELTAG-002`). */
  saisonSchedule?: readonly FLSaisonPhaseSchedule[];
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
        saisonSchedule={saisonSchedule}
        key={spieltag.id}
        spieltag={spieltag}
        onClose={onClose}
      />
    </FormModal>
  );
}
