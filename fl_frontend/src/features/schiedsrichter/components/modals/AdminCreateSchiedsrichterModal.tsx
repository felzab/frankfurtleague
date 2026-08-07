"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { formButton } from "@/shared/components/ui/formButtons";
import { FormModal } from "@/shared/components/ui/FormModal";

import { AdminCreateSchiedsrichterForm } from "../forms/AdminCreateSchiedsrichterForm";

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
        {/* Below `sm` the trigger is the bare plus continuing the search bar (owner, 2026-08-07). */}
        <span className="hidden sm:inline">Neuen Schiedsrichter anlegen</span>
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
