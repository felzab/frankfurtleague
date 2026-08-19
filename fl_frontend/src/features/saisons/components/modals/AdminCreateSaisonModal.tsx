"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSaisonForm } from "@/features/saisons/components/forms/AdminCreateSaisonForm";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

/**
 * Takes no data: a season has nothing to be entered into, so this trigger renders immediately with no
 * `Suspense` boundary and no fallback to reserve its height.
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
