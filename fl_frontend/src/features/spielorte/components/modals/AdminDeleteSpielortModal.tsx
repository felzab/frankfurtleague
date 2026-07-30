"use client";

import { deleteSpielortAction } from "@/features/spielorte/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminDeleteSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  if (!ortData) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielort löschen"
      entityLabel="den Spielort"
      entityName={ortData.name}
      consequence="Bereits eingetragene Spiele behalten den hier hinterlegten Ort samt Maps-Link — er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Spielort erfolgreich gelöscht"
      onConfirm={() => deleteSpielortAction({ id: ortData.id })}
    />
  );
}
