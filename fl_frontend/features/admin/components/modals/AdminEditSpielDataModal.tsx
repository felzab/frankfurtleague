"use client";

import type { FLSpiel } from "@/features/spiele/types";
import { Modal } from "@heroui/react";
import AdminEditSpielDataForm from "../forms/AdminEditSpielDataForm";

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
        <Modal.Dialog className="flex flex-col max-h-[90dvh] bg-primary-light dark:bg-primary-dark">
          <Modal.CloseTrigger /> {/* Optional: Close button */}
          <Modal.Header className="shrink-0">
            <Modal.Heading className="text-fluid-base font-extrabold tracking-tight pb-5">Spielinformationen bearbeiten</Modal.Heading>
          </Modal.Header>
          <Modal.Body className="flex-1 text-text-black dark:text-text-white overflow-y-scroll scrollbar-hide">
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
