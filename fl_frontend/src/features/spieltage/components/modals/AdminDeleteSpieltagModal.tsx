"use client";

import { deleteSpieltagAction } from "@/features/spieltage/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * Retires a matchday. The write is SOFT — it stamps `inactive_since` and the document stays (ADR-0032) —
 * and the consequence line says what that buys: the matchday's matches are not touched and stay readable,
 * because `GET /spiele` never joins `spieltage`.
 *
 * The count is in the sentence rather than a generic reassurance, because the number is the reassurance:
 * "die 6 Spiele bleiben erhalten" is checkable against the row the admin just pressed, and "nichts geht
 * verloren" is not.
 */
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
      entityName={spieltag.name}
      consequence={
        spieltag.spieleAngelegt === 0
          ? "Der Spieltag verschwindet aus den Listen und aus dem Spielplan."
          : `Die ${String(spieltag.spieleAngelegt)} Spiele dieses Spieltags bleiben vollständig erhalten und bearbeitbar. Nur der Spieltag selbst verschwindet aus den Listen und aus dem Spielplan.`
      }
      successMessage="Spieltag stillgelegt"
      onConfirm={() => deleteSpieltagAction({ id: spieltag.id })}
    />
  );
}
