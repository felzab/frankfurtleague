"use client";

import { AdminEditSpieltagForm } from "@/features/spieltage/components/forms/AdminEditSpieltagForm";
import { FormModal } from "@/shared/components/ui/FormModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

export function AdminEditSpieltagModal({
  spieltagData,
  siblingOrderVals,
  isOpen,
  onClose,
}: {
  spieltagData: AdminSpieltagRow | null;
  /** Every `order_val` in the season, from which this row's own is removed below. */
  siblingOrderVals: readonly number[];
  isOpen: boolean;
  onClose: () => void;
}) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const spieltag = useRetainedValue(spieltagData);

  if (!spieltag) return null;

  // This row's own value must not read as a collision with itself. Removing ONE occurrence rather than
  // filtering the value out entirely is what keeps a genuine duplicate visible: where two matchdays
  // already share a position, editing either still reports the clash.
  const others = [...siblingOrderVals];
  const own = others.indexOf(spieltag.order_val);
  if (own !== -1) others.splice(own, 1);

  return (
    <FormModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spieltag bearbeiten">
      <AdminEditSpieltagForm
        key={spieltag.id}
        spieltag={spieltag}
        orderValInUse={others}
        onClose={onClose}
      />
    </FormModal>
  );
}
