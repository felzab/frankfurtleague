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
  if (!spielData) return;
  return (
    <Modal.Backdrop
      isOpen={isOpen}
      onOpenChange={onClose}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className="bg-primary-light dark:bg-primary-dark flex max-h-[90dvh] flex-col">
          <Modal.CloseTrigger /> {/* Optional: Close button */}
          <Modal.Header className="shrink-0">
            <Modal.Heading className="text-fluid-base pb-5 font-extrabold tracking-tight">Spielinformationen bearbeiten</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="text-text-black dark:text-text-white scrollbar-hide flex-1 overflow-y-scroll p-0">
            <AdminEditSpielDataForm
              spielData={spielData}
              onClose={onClose}
            />
          </Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
