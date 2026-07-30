"use client";

import { Modal } from "@heroui/react";

import AdminEditSpielortForm from "../forms/AdminEditSpielortForm";

import type { FLSpielort } from "@/features/spielorte/schemas";

export function AdminEditSpielortModal({ ortData, isOpen, onClose }: { ortData: FLSpielort | null; isOpen: boolean; onClose: () => void }) {
  if (!ortData) return null;

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-background border-border text-foreground flex max-h-modal w-full max-w-2xl flex-col rounded-2xl border p-4 shadow-2xl outline-none">
          <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

          <Modal.Header className="shrink-0 pb-4">
            <Modal.Heading className="text-fluid-lg text-foreground font-extrabold tracking-tight">Spielort bearbeiten</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="scrollbar-hide text-foreground flex-1 overflow-y-auto px-0">
            <AdminEditSpielortForm
              key={ortData.id}
              ortData={ortData}
              onClose={onClose}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
