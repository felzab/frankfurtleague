"use client";

import { Plus } from "@gravity-ui/icons";

import { Button, Modal, useOverlayState } from "@heroui/react";

import AdminCreateSpielortForm from "../forms/AdminCreateSpielortForm";

export function AdminCreateSpielortModal() {
  const modalState = useOverlayState();

  return (
    <>
      <Button
        onPress={modalState.open}
        className="text-fluid-sm bg-brand-solid text-foreground shadow-brand/25 h-12 rounded-xl px-6 py-3 font-bold shadow-lg transition-all active:scale-95 lg:h-15">
        <Plus
          width={18}
          height={18}
        />
        Neuen Spielort anlegen
      </Button>

      <Modal.Backdrop
        isOpen={modalState.isOpen}
        onOpenChange={modalState.setOpen}
        variant="blur">
        <Modal.Container placement="top">
          <Modal.Dialog className="bg-background border-border text-foreground flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-2xl border p-4 shadow-2xl outline-none">
            <Modal.CloseTrigger
              onPress={modalState.close}
              className="text-foreground-muted hover:text-foreground transition-colors"
            />

            <Modal.Header className="shrink-0 pb-4">
              <Modal.Heading className="text-fluid-lg text-foreground font-extrabold tracking-tight">Spielort anlegen</Modal.Heading>
            </Modal.Header>

            <Modal.Body className="scrollbar-hide text-foreground flex-1 overflow-y-auto px-0">
              <AdminCreateSpielortForm onClose={modalState.close} />
            </Modal.Body>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </>
  );
}
