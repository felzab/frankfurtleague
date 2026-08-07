"use client";

import { deleteSpielortAction } from "@/features/spielorte/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminDeleteSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  // Retained, not early-returned: unmounting on close skips the exit transition.
  const ort = useRetainedValue(ortData);

  if (!ort) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielort löschen"
      entityLabel="den Spielort"
      entityName={ort.name}
      consequence="Bereits eingetragene Spiele behalten den hier hinterlegten Ort samt Maps-Link. Er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Spielort erfolgreich gelöscht"
      onConfirm={() => deleteSpielortAction({ id: ort.id })}
    />
  );
}
