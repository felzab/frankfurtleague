"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSaisonForm } from "@/features/saisons/components/forms/AdminCreateSaisonForm";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

/**
 * Takes no data at all, which makes it the simplest of the four create triggers.
 *
 * The club and player creates need the season list because one form also enters the new row into a
 * season; a season has nothing to be entered into, so this trigger renders immediately with no `Suspense`
 * boundary of its own and no fallback to reserve its height.
 */
export function AdminCreateSaisonModal() {
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
        {/* Below `sm` the trigger is the bare plus continuing the search bar (decided 2026-08-07). */}
        <span className="hidden sm:inline">Neue Saison anlegen</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Saison anlegen">
        <AdminCreateSaisonForm onClose={modalState.close} />
      </FormModal>
    </>
  );
}
