"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSpielerForm } from "@/features/spieler/components/forms/AdminCreateSpielerForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { SpielerCreateSaisonOption } from "@/features/spieler/types";

/**
 * Props rather than a fetch: the trigger renders above the page's data boundary.
 *
 * `saisonOptions` holds RUNNING and PLANNED seasons, unlike the club create's planned-only list —
 * a squad is filled in during its season.
 */
export function AdminCreateSpielerModal({
  saisonOptions,
  defaultSaisonId,
}: {
  saisonOptions: SpielerCreateSaisonOption[];
  /** The season preselected in the form — the viewed one when it is running or planned, else the first. */
  defaultSaisonId: string | null;
}) {
  const modalState = useOverlayState();

  return (
    <>
      <Button
        onPress={modalState.open}
        className={formButton({ intent: "trigger" })}>
        <Plus
          width={18}
          height={18}
        />
        <span className="hidden sm:inline">Neuen Spieler anlegen</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Spieler anlegen">
        {saisonOptions.length > 0 && defaultSaisonId !== null ? (
          <AdminCreateSpielerForm
            saisonOptions={saisonOptions}
            defaultSaisonId={defaultSaisonId}
            onClose={modalState.close}
          />
        ) : (
          <Callout
            severity="info"
            title="Keine laufende oder geplante Saison">
            Ein Spieler wird beim Anlegen direkt in einen Kader aufgenommen. Lege zuerst unter „Saisons“ eine Saison an.
          </Callout>
        )}
      </FormModal>
    </>
  );
}
