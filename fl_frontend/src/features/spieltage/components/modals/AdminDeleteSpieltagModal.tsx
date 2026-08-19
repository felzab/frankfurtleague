"use client";

import { deleteSpieltagAction } from "@/features/spieltage/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { AdminSpieltagRow } from "@/features/spieltage/types";

/**
 * Retires a matchday; the write is SOFT. **The consequence line says what happens to the fixtures,
 * which is not "nothing"**: they stay in the database, but the public Spielplan builds itself from
 * the matchdays it received, so they leave with it.
 */
/** One and many are separate sentences: a fixed plural makes "Die 1 Spiele" of a single fixture. */
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
