"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { AdminCreateSaisonForm } from "@/features/saisons/components/forms/AdminCreateSaisonForm";
import { SAISONS_CRUD_COPY } from "@/features/saisons/constants";
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
          aria-hidden="true"
          className="size-4.5"
        />
        {/* Hidden from sight rather than from the tree below `sm`: it is the button's only name. */}
        <span className="max-sm:sr-only">{SAISONS_CRUD_COPY.createLabel}</span>
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
