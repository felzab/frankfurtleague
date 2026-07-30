"use client";

import { Modal } from "@heroui/react";

import AdminEditSpielDataForm from "../forms/AdminEditSpielDataForm/AdminEditSpielDataForm";

import type { FLSpiel } from "@/features/spiele/schemas";

export default function AdminEditSpielDataModal({
  spielData,
  isOpen,
  onClose,
}: {
  spielData: FLSpiel | null;
  isOpen: boolean;
  onClose: () => void;
}) {
  if (!spielData) return null;

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-background border-border text-foreground flex max-h-modal w-full max-w-2xl flex-col rounded-2xl border p-4 shadow-2xl outline-none">
          <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

          <Modal.Header className="shrink-0 pb-4">
            <Modal.Heading className="text-fluid-lg text-foreground font-extrabold tracking-tight">Spielinformationen bearbeiten</Modal.Heading>
          </Modal.Header>

          <Modal.Body className="scrollbar-hide scrollbar-gutter-stable text-foreground flex-1 overflow-y-auto px-0">
            <AdminEditSpielDataForm
              key={spielData.id}
              spielData={spielData}
              onClose={onClose}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
