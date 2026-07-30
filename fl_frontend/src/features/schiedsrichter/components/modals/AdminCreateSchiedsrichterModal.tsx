"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import AdminCreateSchiedsrichterForm from "../forms/AdminCreateSchiedsrichterForm";

export function AdminCreateSchiedsrichterModal() {
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
        Neuen Schiedsrichter anlegen
      </Button>

      <FormModal
        isOpen={modalState.isOpen}
        onClose={modalState.close}
        heading="Schiedsrichter anlegen">
        <AdminCreateSchiedsrichterForm onClose={modalState.close} />
      </FormModal>
    </>
  );
}
