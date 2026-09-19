"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { SPIELORTE_CRUD_COPY } from "@/features/spielorte/constants";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import { AdminCreateSpielortForm } from "../forms/AdminCreateSpielortForm";

export function AdminCreateSpielortModal() {
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
        <span className="max-sm:sr-only">{SPIELORTE_CRUD_COPY.createLabel}</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Spielort anlegen">
        <AdminCreateSpielortForm onClose={modalState.close} />
      </FormModal>
    </>
  );
}
