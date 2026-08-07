"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateTeamForm } from "@/features/teams/components/forms/AdminCreateTeamForm";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import type { FLSaison } from "@/features/saisons/schemas";

/**
 * Takes the season list as a prop rather than fetching: the trigger renders above the page's data
 * boundary, and the route wraps this modal in its own `Suspense` so the fetch never blocks the shell.
 */
export function AdminCreateTeamModal({ saisons, currentSaisonId }: { saisons: FLSaison[]; currentSaisonId: string }) {
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
        Neues Team anlegen
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Team anlegen">
        <AdminCreateTeamForm
          saisons={saisons}
          currentSaisonId={currentSaisonId}
          onClose={modalState.close}
        />
      </FormModal>
    </>
  );
}
