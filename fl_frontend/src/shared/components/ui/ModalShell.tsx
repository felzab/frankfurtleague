"use client";

import { tv } from "tailwind-variants";

import { Modal } from "@heroui/react";

import type { ReactNode } from "react";

/**
 * The one modal appearance. Before this the 20-class dialog string was duplicated byte-for-byte at
 * five sites with two more near-variants (R4 §8.2), so the app had three unrelated modal looks and
 * the only one the public ever saw was the odd one out.
 */
const modalShell = tv({
  slots: {
    dialog: "bg-background border-border text-foreground flex w-full flex-col rounded-2xl border p-4 shadow-2xl outline-none",
    header: "shrink-0 pb-4",
    heading: "text-fluid-lg text-foreground font-extrabold tracking-tight",
    body: "scrollbar-hide text-foreground px-0",
  },
  variants: {
    size: {
      form: { dialog: "max-h-modal max-w-2xl", body: "flex-1 scrollbar-gutter-stable overflow-y-auto" },
      confirm: { dialog: "max-w-md", header: "pt-2", body: "pb-2" },
    },
  },
  defaultVariants: { size: "form" },
});

export function ModalShell({
  isOpen,
  onClose,
  heading,
  icon,
  size,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  heading: string;
  /** Rendered to the left of the heading — the destructive confirmations' danger badge. */
  icon?: ReactNode;
  size?: "form" | "confirm";
  children: ReactNode;
}) {
  const styles = modalShell({ size });

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      // HeroUI reports both directions; the shell only owns closing. Callers that need the open
      // edge (the create modals) keep their own `useOverlayState` around it.
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      variant="blur">
      <Modal.Container placement="top">
        <Modal.Dialog className={styles.dialog()}>
          <Modal.CloseTrigger className="text-foreground-muted hover:text-foreground transition-colors" />

          <Modal.Header className={styles.header()}>
            <div className="flex items-center gap-4">
              {icon}
              <Modal.Heading className={styles.heading()}>{heading}</Modal.Heading>
            </div>
          </Modal.Header>

          <Modal.Body className={styles.body()}>{children}</Modal.Body>
        </Modal.Dialog>
      </Modal.Container>
    </Modal.Backdrop>
  );
}
