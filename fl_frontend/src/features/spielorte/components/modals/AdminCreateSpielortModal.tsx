"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

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
          width={18}
          height={18}
        />
        {/* Below `sm` the trigger is the bare plus continuing the search bar (owner, 2026-08-07). */}
        <span className="hidden sm:inline">Neuen Spielort anlegen</span>
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
