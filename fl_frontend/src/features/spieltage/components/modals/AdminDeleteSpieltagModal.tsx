"use client";

import { deleteSpieltagAction } from "@/features/spieltage/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * Retires a matchday. The write is SOFT — it stamps `inactive_since` and the document stays (ADR-0025).
 *
 * **The consequence line says what actually happens to the fixtures, which is not "nothing".** They are
 * untouched in the database and `GET /spiele` still returns them, but the public Spielplan builds itself
 * from the matchdays it received and a retired one is not among them — so the fixtures leave that page
 * with their container. That is why `REQ-RETIRE-002` refuses this while any of them carries a result, and
 * why the list disables the control rather than letting the dialog open on a refusal.
 *
 * The count is in the sentence rather than a generic reassurance, because the number is what an admin can
 * check against the row they just pressed.
 */
/**
 * The consequence sentence for a given fixture count.
 *
 * One and many are separate sentences rather than one with the number substituted: a single fixture makes
 * "Die 1 Spiele" out of any sentence carrying a fixed plural.
 */
function describeConsequence(spieleAngelegt: number): string {
  if (spieleAngelegt === 0) return "Der Spieltag verschwindet aus den Listen und aus dem Spielplan.";
  if (spieleAngelegt === 1) {
    return "Das eine Spiel dieses Spieltags bleibt erhalten und bearbeitbar, verschwindet mit dem Spieltag aber aus dem öffentlichen Spielplan. Es hat noch kein Ergebnis, sonst wäre das Stilllegen nicht möglich.";
  }
  return `Die ${String(spieleAngelegt)} Spiele dieses Spieltags bleiben erhalten und bearbeitbar, verschwinden mit dem Spieltag aber aus dem öffentlichen Spielplan. Keines von ihnen hat ein Ergebnis, sonst wäre das Stilllegen nicht möglich.`;
}

export function AdminDeleteSpieltagModal({
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
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spieltag stilllegen"
      entityLabel="den Spieltag"
      entityName={spieltag.label}
      consequence={describeConsequence(spieltag.spieleAngelegt)}
      successMessage="Spieltag stillgelegt"
      onConfirm={() => deleteSpieltagAction({ id: spieltag.id })}
    />
  );
}
