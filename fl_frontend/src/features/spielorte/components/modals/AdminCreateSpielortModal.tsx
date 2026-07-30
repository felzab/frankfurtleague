"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, useOverlayState } from "@heroui/react";

import { FormModal } from "@/shared/components/ui/FormModal";

import AdminCreateSpielortForm from "../forms/AdminCreateSpielortForm";

export function AdminCreateSpielortModal() {
  const modalState = useOverlayState();

  return (
    <>
      <Button
        onPress={modalState.open}
        className="text-fluid-sm bg-brand-solid text-brand-solid-foreground shadow-brand/25 h-12 rounded-xl px-6 py-3 font-bold shadow-lg transition-all active:scale-95 lg:h-15">
        <Plus
          width={18}
          height={18}
        />
        Neuen Spielort anlegen
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
