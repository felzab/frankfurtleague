"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, Modal, useOverlayState } from "@heroui/react";

import AdminCreateSchiedsrichterForm from "../forms/AdminCreateSchiedsrichterForm";

export function AdminCreateSchiedsrichterModal() {
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
        Neuen Schiedsrichter anlegen
      </Button>

      <Modal.Backdrop
        isOpen={modalState.isOpen}
        onOpenChange={modalState.setOpen}
        variant="blur">
        <Modal.Container placement="top">
          <Modal.Dialog className="bg-background border-border text-foreground max-h-modal flex w-full max-w-2xl flex-col rounded-2xl border p-4 shadow-2xl outline-none">
            <Modal.CloseTrigger
              onPress={modalState.close}
              className="text-foreground-muted hover:text-foreground transition-colors"
            />

            <Modal.Header className="shrink-0 pb-4">
              <Modal.Heading className="text-fluid-lg text-foreground font-extrabold tracking-tight">Schiedsrichter anlegen</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="scrollbar-hide text-foreground flex-1 scrollbar-gutter-stable overflow-y-auto px-0">
              <AdminCreateSchiedsrichterForm onClose={modalState.close} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
