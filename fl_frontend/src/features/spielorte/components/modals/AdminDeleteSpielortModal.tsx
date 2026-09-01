"use client";

import { deleteSpielortAction } from "@/features/spielorte/actions";
import { ConfirmDeleteModal } from "@/shared/components/ui/ConfirmDeleteModal";
import { useRetainedValue } from "@/shared/hooks/useRetainedValue";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminDeleteSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  const ort = useRetainedValue(ortData);

  if (!ort) return null;

  return (
    <ConfirmDeleteModal
      isOpen={isOpen}
      onClose={onClose}
      heading="Spielort stilllegen"
      entityLabel="den Spielort"
      entityName={ort.name}
      consequence="Schon eingetragene Spiele behalten diesen Ort. Er steht künftig nur nicht mehr zur Auswahl."
      successMessage="Spielort stillgelegt"
      onConfirm={() => deleteSpielortAction({ id: ort.id })}
    />
  );
}
