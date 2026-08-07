"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateTeamForm } from "@/features/teams/components/forms/AdminCreateTeamForm";
import { Callout } from "@/shared/components/ui/Callout";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { TeamCreateSaisonOption } from "@/features/teams/types";

/**
 * Takes its data as props rather than fetching: the trigger renders above the page's data boundary,
 * and the route wraps this modal in its own `Suspense` so the fetch never blocks the shell.
 *
 * `saisonOptions` is only the PLANNED seasons (owner, 2026-08-07): a team enters a season before it
 * starts, never after — so with none planned, the trigger still opens and the dialog says why there
 * is nothing to fill in, instead of offering a create the backend must refuse (REQ-ENTER-001).
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
        {/* Below `sm` the trigger is the bare plus continuing the search bar (owner, 2026-08-07). */}
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
