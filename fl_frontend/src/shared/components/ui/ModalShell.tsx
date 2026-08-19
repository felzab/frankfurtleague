"use client";

import { tv } from "tailwind-variants";

import { Modal } from "@heroui/react";

import { dismissControl } from "@/core/dismissControl";

import type { ReactNode } from "react";

/**
 * The horizontal inset is on the header and body, not the dialog. **`mx-0` is load-bearing**: `@heroui/styles`
 * `modal.css` insets `.modal__body` with a negative margin it cancels with equal padding.
 */
const modalShell = tv({
  slots: {
    dialog: "bg-background border-border text-foreground flex w-full flex-col rounded-2xl border px-0 py-4 shadow-2xl outline-none",
    header: "shrink-0 px-4 pb-4",
    heading: "fluid-lg text-foreground font-extrabold tracking-tight",
    body: "scrollbar-hide text-foreground mx-0 px-4",
  },
  variants: {
    size: {
      form: { dialog: "max-h-modal max-w-2xl", body: "flex-1 scrollbar-gutter-stable overflow-y-auto" },
      /* Both confirmation dialogs share this size, so the delete and the discard stay one family. */
      confirm: { dialog: "max-w-sm", header: "pt-2", body: "pb-2" },
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
  role,
  children,
}: {
  isOpen: boolean;
  onClose: () => void;
  heading: string;
  /** Rendered to the left of the heading — the destructive confirmations' danger badge. */
  icon?: ReactNode;
  size?: "form" | "confirm";
  /** `"alertdialog"` for an irreversible action, so a screen reader signals it as one rather than as a benign create dialog. */
  role?: "dialog" | "alertdialog";
  children: ReactNode;
}) {
  const styles = modalShell({ size });

  return (
    <Modal.Backdrop
      isOpen={isOpen}
      // HeroUI reports both directions; the shell only owns closing, and a caller needing the open edge keeps its own state.
      onOpenChange={(open: boolean) => {
        if (!open) onClose();
      }}
      variant="opaque">
      {/* The blur must stay on this empty sibling: Chromium drops a `backdrop-filter` permanently once animated
          content composites inside the filtered subtree, and an element with no children has no such subtree. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 backdrop-blur-md"
      />
      <Modal.Container placement="top">
        <Modal.Dialog
          role={role}
          className={styles.dialog()}>
          {/* One label for every dialog: this shell is the base of all of them and none can say anything more specific. */}
          <Modal.CloseTrigger {...dismissControl({ label: "Dialog schließen" })} />

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
