"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateTeamForm } from "@/features/teams/components/forms/AdminCreateTeamForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { TeamCreateSaisonOption } from "@/features/teams/types";

/**
 * Props rather than a fetch: the trigger renders above the page's data boundary.
 *
 * `saisonOptions` is only the PLANNED seasons — any other would be a create the backend must
 * refuse (`REQ-ENTER-001`).
 */
export function AdminCreateTeamModal({
  saisonOptions,
  defaultSaisonId,
}: {
  saisonOptions: TeamCreateSaisonOption[];
  /** The season preselected in the form — the viewed one when it is planned, else the next planned. */
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
        <span className="hidden sm:inline">Neues Team anlegen</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Team anlegen">
        {saisonOptions.length > 0 && defaultSaisonId !== null ? (
          <AdminCreateTeamForm
            saisonOptions={saisonOptions}
            defaultSaisonId={defaultSaisonId}
            onClose={modalState.close}
          />
        ) : (
          <Callout
            severity="info"
            title="Keine geplante Saison">
            Teams können nur in eine geplante Saison aufgenommen werden, und derzeit ist keine angelegt. Lege zuerst die kommende Saison an.
          </Callout>
        )}
      </FormModal>
    </>
  );
}
