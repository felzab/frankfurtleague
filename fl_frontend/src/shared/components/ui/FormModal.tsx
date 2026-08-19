"use client";

import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/**
 * A form-sized modal: heading plus a scrolling body. A form that has outgrown a dialog gets a route rather than a wider
 * variant here.
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
