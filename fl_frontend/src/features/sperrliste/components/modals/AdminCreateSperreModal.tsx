"use client";

import Plus from "@gravity-ui/icons/Plus";

import { useOverlayState } from "@heroui/react";
import { Button } from "@heroui/react/button";

import { SPERRLISTE_CRUD_COPY } from "@/features/sperrliste/constants";
import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import { AdminCreateSperreForm } from "../forms/AdminCreateSperreForm";

export function AdminCreateSperreModal() {
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
        <span className="max-sm:sr-only">{SPERRLISTE_CRUD_COPY.createLabel}</span>
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Adresse sperren">
        <AdminCreateSperreForm onClose={modalState.close} />
      </FormModal>
    </>
  );
}
