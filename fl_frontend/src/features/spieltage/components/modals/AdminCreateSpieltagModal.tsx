"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSpieltagForm } from "@/features/spieltage/components/forms/AdminCreateSpieltagForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

/**
 * Takes only its season as a prop: the order is derived, so unlike the earlier version there is no
 * next-free-position to compute and nothing about the season's existing matchdays the form needs
 * (ADR-0064).
 *
 * **A matchday is created into the season the sidemenu selector holds**, which is why there is no season
 * picker in the form. `saisonId` is null only where the league has no seasons at all — a fresh database —
 * and the dialog then says so instead of offering a form that cannot submit.
 */
export function AdminCreateSpieltagModal({ saisonId }: { saisonId: string | null }) {
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
        {/* Below `sm` the trigger is the bare plus continuing the search bar (owner, 2026-08-07). */}
        <span className="hidden sm:inline">Neuen Spieltag anlegen</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading={saisonId === null ? "Spieltag anlegen" : `Spieltag der Saison ${saisonId} anlegen`}>
        {saisonId === null ? (
          <Callout
            severity="info"
            title="Keine Saison angelegt">
            Ein Spieltag gehört zu einer Saison und trägt ihre ID. Lege zuerst eine Saison an.
          </Callout>
        ) : (
          <AdminCreateSpieltagForm
            saisonId={saisonId}
            onClose={modalState.close}
          />
        )}
      </FormModal>
    </>
  );
}
