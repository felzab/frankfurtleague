"use client";

import { ModalShell } from "./ModalShell";

import type { ReactNode } from "react";

/**
 * A form-sized modal: heading plus a scrolling body. The four admin create/edit modals differ only in
 * their heading and their children, so they are all this component.
 *
 * A form that has outgrown a dialog gets a route instead of a wider variant here — the match editor is
 * the case, and ADR-0050 carries the measurements that decided it.
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
