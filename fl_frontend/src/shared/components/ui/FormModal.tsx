"use client";

import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/**
 * A form-sized modal: heading plus a scrolling body. Absorbs the four admin create/edit modals and
 * `AdminEditSpielDataModal`, which differed only in their heading and their children.
 */
export function FormModal({
  isOpen,
  onClose,
  heading,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  heading: string;
  children: ReactNode;
}) {
  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      heading={heading}
      size="form">
      {children}
    </ModalShell>
  );
}
