"use client";

import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/**
 * A form-sized modal: heading plus a scrolling body. Every admin create/edit modal differs only in
 * its heading and its children, so they are all this component.
 *
 * A form that has outgrown a dialog gets a route instead of a wider variant here — the match editor is
 * the case.
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
